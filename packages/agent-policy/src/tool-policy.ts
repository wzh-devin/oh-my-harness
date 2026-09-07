import { randomUUID } from 'node:crypto'

export const TOOL_PERMISSIONS = [
  'read-only',
  'workspace-write',
  'full-access',
] as const

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number]
export type ApprovalDecision = 'approve-once' | 'reject'
export type ToolEffect = 'execute' | 'read' | 'write' | 'mcp'

interface ToolAuthorizationBase {
  permission: ToolPermission
  runId: string
  sessionId: string
  toolCallId: string
}

export interface FileToolAuthorizationRequest extends ToolAuthorizationBase {
  effect: 'read' | 'write'
  path: string
  scope: 'workspace' | 'external'
  toolName: 'edit' | 'read' | 'write'
}

export interface BashToolAuthorizationRequest extends ToolAuthorizationBase {
  command: string
  effect: 'execute'
  toolName: 'bash'
}

export type ToolAuthorizationRequest =
  | BashToolAuthorizationRequest
  | FileToolAuthorizationRequest
  | McpToolAuthorizationRequest

export interface McpToolAuthorizationRequest extends ToolAuthorizationBase {
  effect: 'mcp'
  toolName: 'mcp'
  connectionId: string
  remoteToolName: string
  input: Record<string, unknown>
}

export type PendingToolApproval = ToolAuthorizationRequest & {
  approvalId: string
}

export type ApprovalResolution = PendingToolApproval & {
  decision: ApprovalDecision
  reason: 'aborted' | 'server-closed' | 'user'
}

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

/** 校验来自 API 的权限值，避免客户端扩大服务端能力。 */
export const isToolPermission = (value: unknown): value is ToolPermission =>
  TOOL_PERMISSIONS.some((permission) => permission === value)

/** 对固定工具矩阵做无副作用决策。 */
export const evaluateToolPolicy = (
  request: ToolAuthorizationRequest,
): 'allow' | 'deny' | 'require-approval' => {
  if (!isToolPermission(request.permission)) return 'deny'
  if (request.toolName === 'mcp' && request.effect === 'mcp')
    return 'require-approval'
  if (request.toolName === 'bash' && request.effect === 'execute') {
    return request.permission === 'full-access' ? 'allow' : 'require-approval'
  }
  if (
    (request.toolName === 'read' && request.effect === 'read') ||
    ((request.toolName === 'write' || request.toolName === 'edit') &&
      request.effect === 'write')
  ) {
    if (request.scope !== 'workspace' && request.scope !== 'external')
      return 'deny'
    if (request.permission === 'full-access') return 'allow'
    if (request.scope === 'external') return 'require-approval'
    return request.effect === 'read' || request.permission === 'workspace-write'
      ? 'allow'
      : 'require-approval'
  }
  return 'deny'
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
    if (decision === 'allow') return
    if (decision === 'deny') {
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
      void this.resolveState(state, 'reject', 'aborted').catch(() => undefined)
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
    if (decision === 'approve-once') {
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
