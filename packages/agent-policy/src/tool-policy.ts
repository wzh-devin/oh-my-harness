import { randomUUID } from 'node:crypto'
import {
  APPROVAL_RESOLUTION_REASON,
  TOOL_POLICY_ERROR_CODE,
  type ToolPolicyErrorCode,
} from '@oh-my-harness/shared'

import {
  APPROVAL_DECISION,
  FILE_SCOPE,
  POLICY_DECISION,
  TOOL_EFFECT,
  TOOL_PERMISSION,
  getPolicyTool,
  isToolPermission,
  type ApprovalDecision,
  type ApprovalResolution,
  type PendingToolApproval,
  type PolicyDecision,
  type ToolAuthorizationRequest,
} from './contracts.ts'

interface ApprovalHooks {
  onRequested(approval: PendingToolApproval): Promise<void>
  onResolved(resolution: ApprovalResolution): Promise<void>
}

interface PendingState {
  approval: PendingToolApproval
  complete(error?: ToolPolicyError): void
  hooks: ApprovalHooks
  resolving: boolean
}

export type { ToolPolicyErrorCode }

export class ToolPolicyError extends Error {
  readonly code: ToolPolicyErrorCode

  constructor(code: ToolPolicyErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ToolPolicyError'
    this.code = code
  }
}

/** 对固定工具矩阵做无副作用决策，未知权限或能力组合一律拒绝。 */
export const evaluateToolPolicy = (
  request: ToolAuthorizationRequest,
): PolicyDecision => {
  if (!isToolPermission(request.permission)) return POLICY_DECISION.DENY
  const tool = getPolicyTool(request.toolName)
  if (!tool || request.effect !== tool.effect) return POLICY_DECISION.DENY
  if (request.effect === TOOL_EFFECT.MCP)
    return POLICY_DECISION.REQUIRE_APPROVAL
  if (request.effect === TOOL_EFFECT.EXECUTE) {
    return request.permission === TOOL_PERMISSION.FULL_ACCESS
      ? POLICY_DECISION.ALLOW
      : POLICY_DECISION.REQUIRE_APPROVAL
  }
  if (request.scope === FILE_SCOPE.ATTACHMENT)
    return request.effect === TOOL_EFFECT.READ
      ? POLICY_DECISION.ALLOW
      : POLICY_DECISION.DENY
  if (
    request.scope !== FILE_SCOPE.WORKSPACE &&
    request.scope !== FILE_SCOPE.EXTERNAL
  )
    return POLICY_DECISION.DENY
  if (request.permission === TOOL_PERMISSION.FULL_ACCESS)
    return POLICY_DECISION.ALLOW
  if (request.scope === FILE_SCOPE.EXTERNAL)
    return POLICY_DECISION.REQUIRE_APPROVAL
  return request.effect === TOOL_EFFECT.READ ||
    request.permission === TOOL_PERMISSION.WORKSPACE_WRITE
    ? POLICY_DECISION.ALLOW
    : POLICY_DECISION.REQUIRE_APPROVAL
}

/** 保存活跃 Run 的单次审批，不持久化会话级授权。 */
export class ToolPolicy {
  private readonly pending = new Map<string, PendingState>()
  private readonly resolved = new Map<
    string,
    { runId: string; sessionId: string }
  >()

  async authorize(
    request: ToolAuthorizationRequest,
    hooks: ApprovalHooks,
    signal?: AbortSignal,
  ) {
    const decision = evaluateToolPolicy(request)
    if (decision === POLICY_DECISION.ALLOW) return
    if (decision === POLICY_DECISION.DENY) {
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.TOOL_PERMISSION_DENIED,
        '当前工具调用不在允许的能力范围内。',
      )
    }
    if (signal?.aborted) {
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.TOOL_APPROVAL_REJECTED,
        '工具调用已取消。',
      )
    }

    const approval: PendingToolApproval = {
      ...request,
      approvalId: randomUUID(),
    }
    let complete!: (error?: ToolPolicyError) => void
    const waiting = new Promise<void>((resolve, reject) => {
      complete = (error) => (error ? reject(error) : resolve())
    })
    const state: PendingState = {
      approval,
      complete,
      hooks,
      resolving: false,
    }
    this.pending.set(approval.approvalId, state)

    try {
      await hooks.onRequested(approval)
    } catch (error) {
      this.pending.delete(approval.approvalId)
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.TOOL_APPROVAL_AUDIT_FAILED,
        '工具审批请求无法持久化。',
        error,
      )
    }

    const onAbort = () => {
      void this.resolveState(
        state,
        APPROVAL_DECISION.REJECT,
        APPROVAL_RESOLUTION_REASON.ABORTED,
      ).catch(() => undefined)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    try {
      await waiting
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 返回 Session 当前可恢复展示的待审批请求。 */
  pendingForSession(sessionId: string) {
    return [...this.pending.values()]
      .filter((state) => state.approval.sessionId === sessionId)
      .map((state) => state.approval)
  }

  /** 以服务端保存的原调用完成一次审批。 */
  async resolveApproval(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) {
    const state = this.pending.get(approvalId)
    const resolved = this.resolved.get(approvalId)
    if (resolved?.sessionId === sessionId) {
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.APPROVAL_ALREADY_RESOLVED,
        '工具审批已经处理。',
      )
    }
    if (!state || state.approval.sessionId !== sessionId) {
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.APPROVAL_NOT_FOUND,
        '待审批工具调用不存在。',
      )
    }
    if (state.resolving) {
      throw new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.APPROVAL_ALREADY_RESOLVED,
        '工具审批已经处理。',
      )
    }
    await this.resolveState(state, decision, APPROVAL_RESOLUTION_REASON.USER)
  }

  /** Run 结束后清理仅用于并发决议保护的审批墓碑。 */
  clearRun(runId: string) {
    for (const [approvalId, resolved] of this.resolved) {
      if (resolved.runId === runId) this.resolved.delete(approvalId)
    }
  }

  private async resolveState(
    state: PendingState,
    decision: ApprovalDecision,
    reason: ApprovalResolution['reason'],
  ) {
    if (state.resolving || !this.pending.has(state.approval.approvalId)) return
    state.resolving = true
    try {
      await state.hooks.onResolved({ ...state.approval, decision, reason })
    } catch (error) {
      const policyError = new ToolPolicyError(
        TOOL_POLICY_ERROR_CODE.TOOL_APPROVAL_AUDIT_FAILED,
        '工具审批结果无法持久化。',
        error,
      )
      this.pending.delete(state.approval.approvalId)
      state.complete(policyError)
      throw policyError
    }

    this.pending.delete(state.approval.approvalId)
    this.resolved.set(state.approval.approvalId, {
      runId: state.approval.runId,
      sessionId: state.approval.sessionId,
    })
    if (decision === APPROVAL_DECISION.APPROVE_ONCE) {
      state.complete()
    } else {
      state.complete(
        new ToolPolicyError(
          TOOL_POLICY_ERROR_CODE.TOOL_APPROVAL_REJECTED,
          reason === APPROVAL_RESOLUTION_REASON.USER
            ? '用户拒绝了工具调用。'
            : '工具调用已取消。',
        ),
      )
    }
  }
}
