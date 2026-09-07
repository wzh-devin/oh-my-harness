import { randomUUID } from 'node:crypto'

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

export type ToolPolicyErrorCode =
  | 'APPROVAL_ALREADY_RESOLVED'
  | 'APPROVAL_NOT_FOUND'
  | 'TOOL_APPROVAL_AUDIT_FAILED'
  | 'TOOL_APPROVAL_REJECTED'
  | 'TOOL_PERMISSION_DENIED'

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
  if (!isToolPermission(request.permission)) return POLICY_DECISION.deny
  const tool = getPolicyTool(request.toolName)
  if (!tool || request.effect !== tool.effect) return POLICY_DECISION.deny
  if (request.effect === TOOL_EFFECT.mcp) return POLICY_DECISION.requireApproval
  if (request.effect === TOOL_EFFECT.execute) {
    return request.permission === TOOL_PERMISSION.fullAccess
      ? POLICY_DECISION.allow
      : POLICY_DECISION.requireApproval
  }
  if (
    request.scope !== FILE_SCOPE.workspace &&
    request.scope !== FILE_SCOPE.external
  )
    return POLICY_DECISION.deny
  if (request.permission === TOOL_PERMISSION.fullAccess)
    return POLICY_DECISION.allow
  if (request.scope === FILE_SCOPE.external)
    return POLICY_DECISION.requireApproval
  return request.effect === TOOL_EFFECT.read ||
    request.permission === TOOL_PERMISSION.workspaceWrite
    ? POLICY_DECISION.allow
    : POLICY_DECISION.requireApproval
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
    if (decision === POLICY_DECISION.allow) return
    if (decision === POLICY_DECISION.deny) {
      throw new ToolPolicyError(
        'TOOL_PERMISSION_DENIED',
        '当前工具调用不在允许的能力范围内。',
      )
    }
    if (signal?.aborted) {
      throw new ToolPolicyError('TOOL_APPROVAL_REJECTED', '工具调用已取消。')
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
        'TOOL_APPROVAL_AUDIT_FAILED',
        '工具审批请求无法持久化。',
        error,
      )
    }

    const onAbort = () => {
      void this.resolveState(state, APPROVAL_DECISION.reject, 'aborted').catch(
        () => undefined,
      )
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
        'APPROVAL_ALREADY_RESOLVED',
        '工具审批已经处理。',
      )
    }
    if (!state || state.approval.sessionId !== sessionId) {
      throw new ToolPolicyError('APPROVAL_NOT_FOUND', '待审批工具调用不存在。')
    }
    if (state.resolving) {
      throw new ToolPolicyError(
        'APPROVAL_ALREADY_RESOLVED',
        '工具审批已经处理。',
      )
    }
    await this.resolveState(state, decision, 'user')
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
        'TOOL_APPROVAL_AUDIT_FAILED',
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
    if (decision === APPROVAL_DECISION.approveOnce) {
      state.complete()
    } else {
      state.complete(
        new ToolPolicyError(
          'TOOL_APPROVAL_REJECTED',
          reason === 'user' ? '用户拒绝了工具调用。' : '工具调用已取消。',
        ),
      )
    }
  }
}
