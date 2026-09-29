import {
  POLICY_TOOL,
  TOOL_EFFECT,
  getFileTool,
  isToolPermission,
} from '@oh-my-harness/agent-policy/contracts'
import {
  AGENT_RUN_EVENT_TYPE,
  CONTEXT_COMPACTION_STATUS,
  TODO_STATUS,
  TOOL_ACTIVITY_KIND,
  TOOL_EXECUTION_ACTION,
  TOOL_EXECUTION_EVENT_TYPE,
  TOOL_EXECUTION_STATE,
  type ToolExecutionAction,
} from '@oh-my-harness/shared'
import { parseTraceUpdate } from '../../../trace/api/index.ts'
import type {
  AgentRunEventVo,
  AgentSessionDetailVo,
  AgentSessionMessagePageVo,
  AgentSessionVo,
  AgentSessionToolVo,
  AgentTodoItemVo,
  BashOutcomeVo,
  ContextUsageVo,
  PendingToolApprovalVo,
  ToolExecutionOutputVo,
  ToolExecutionVo,
} from '../types/index.ts'
import type { ApprovalDecision } from '../../message/index.ts'
import type {
  ModelThinkingLevel,
  PermissionId,
} from '../../../settings/index.ts'

interface CreateAgentSessionInput {
  modelId: string
  name?: string
  providerId: string
  workspaceId: string
}

interface UpdateAgentSessionModelInput {
  modelId: string
  providerId: string
}

interface UpdateAgentSessionArchiveInput {
  archived: boolean
}

interface RenameAgentSessionInput {
  name: string
}

interface ParsedSseFrames {
  events: AgentRunEventVo[]
  remainder: string
}

export interface StreamAgentMessageInput {
  attachments: readonly File[]
  commandId?: string
  content: string
  permission: PermissionId
  skillIds: readonly string[]
  mcpServerIds?: readonly string[]
  pluginIds?: readonly string[]
  thinkingLevel: ModelThinkingLevel
}

export interface ReconnectedAgentRun {
  completed: Promise<void>
}

export class AgentSessionApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status = 0) {
    super(message)
    this.name = 'AgentSessionApiError'
    this.code = code
    this.status = status
  }
}

const bashInput = (value: unknown): { command: string } | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  return typeof input.command === 'string' &&
    input.command.length > 0 &&
    !input.command.includes('\0') &&
    new TextEncoder().encode(input.command).byteLength <= 32 * 1024
    ? { command: input.command }
    : undefined
}

const bashOutcome = (value: unknown): BashOutcomeVo | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const outcome = value as Record<string, unknown>
  if (
    (typeof outcome.exitCode !== 'number' && outcome.exitCode !== null) ||
    typeof outcome.outputExceeded !== 'boolean' ||
    (typeof outcome.signal !== 'string' && outcome.signal !== null) ||
    typeof outcome.timedOut !== 'boolean'
  ) {
    return
  }
  return {
    exitCode: outcome.exitCode,
    outputExceeded: outcome.outputExceeded,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
  } as BashOutcomeVo
}

const todoItems = (value: unknown): AgentTodoItemVo[] | undefined => {
  if (!Array.isArray(value) || value.length > 50) return
  const seen = new Set<string>()
  let activeCount = 0
  const todos: AgentTodoItemVo[] = []
  for (const candidate of value) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return
    }
    const item = candidate as Record<string, unknown>
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (
      Object.keys(item).length !== 2 ||
      content !== item.content ||
      !content ||
      Array.from(content).length > 200 ||
      (item.status !== TODO_STATUS.PENDING &&
        item.status !== TODO_STATUS.IN_PROGRESS &&
        item.status !== TODO_STATUS.COMPLETED) ||
      seen.has(content)
    ) {
      return
    }
    seen.add(content)
    if (item.status === TODO_STATUS.IN_PROGRESS && ++activeCount > 1) return
    todos.push({ content, status: item.status })
  }
  return todos
}

/** 校验服务端 SSE 携带的可选上下文快照。 */
const contextUsage = (value: unknown): ContextUsageVo | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const usage = value as Record<string, unknown>
  if (
    typeof usage.modelId !== 'string' ||
    typeof usage.providerId !== 'string' ||
    ![
      'contextWindow',
      'inputLimit',
      'messageTokens',
      'systemTokens',
      'toolsTokens',
      'usedTokens',
    ].every(
      (key) =>
        Number.isSafeInteger(usage[key]) &&
        (usage[key] as number) >= (key === 'contextWindow' ? 1 : 0),
    )
  ) {
    return
  }
  return usage as unknown as ContextUsageVo
}

const sessionPath = (sessionId: string) =>
  `/api/agent/sessions/${encodeURIComponent(sessionId)}`

const executionPath = (sessionId: string, executionId?: string) =>
  `${sessionPath(sessionId)}/tool-executions${executionId ? `/${encodeURIComponent(executionId)}` : ''}`

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined
    throw new AgentSessionApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code ?? 'AGENT_REQUEST_FAILED',
      response.status,
    )
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T)
}

const toolActivityKindMap = {
  command: true,
  edit: true,
  read: true,
  skill: true,
  tool: true,
} satisfies Record<AgentSessionToolVo['kind'], boolean>
const isToolActivityKind = (
  value: unknown,
): value is AgentSessionToolVo['kind'] =>
  typeof value === 'string' && Object.hasOwn(toolActivityKindMap, value)

/** HTTP 恢复与 SSE 共用审批解析，拒绝枚举成员合法但组合错误的对象。 */
const parseToolApproval = (
  value: unknown,
): PendingToolApprovalVo | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const event = value as Record<string, unknown>
  if (
    event.type !== AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED ||
    typeof event.approvalId !== 'string' ||
    !event.approvalId ||
    typeof event.title !== 'string' ||
    typeof event.toolCallId !== 'string' ||
    !event.toolCallId
  )
    return
  const common = {
    approvalId: event.approvalId,
    title: event.title,
    toolCallId: event.toolCallId,
    type: AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED,
  }
  const sessionCapability =
    event.canApproveSession === true ? { canApproveSession: true as const } : {}
  if (
    event.kind === TOOL_ACTIVITY_KIND.TOOL &&
    typeof event.serverId === 'string' &&
    event.serverId &&
    typeof event.label === 'string' &&
    typeof event.toolName === 'string' &&
    event.toolName &&
    event.input &&
    typeof event.input === 'object' &&
    !Array.isArray(event.input)
  )
    return {
      ...common,
      kind: TOOL_ACTIVITY_KIND.TOOL,
      serverId: event.serverId,
      label: event.label,
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
    }
  if (
    event.kind === TOOL_ACTIVITY_KIND.COMMAND &&
    event.toolName === POLICY_TOOL.BASH.toolName
  ) {
    const input = bashInput(event.input)
    if (input)
      return {
        ...common,
        ...sessionCapability,
        kind: TOOL_ACTIVITY_KIND.COMMAND,
        toolName: POLICY_TOOL.BASH.toolName,
        input,
      }
    return
  }
  if (typeof event.path !== 'string') return
  const fileTool = getFileTool(event.toolName)
  if (
    fileTool?.effect === TOOL_EFFECT.READ &&
    event.kind === TOOL_ACTIVITY_KIND.READ
  )
    return {
      ...common,
      ...sessionCapability,
      kind: TOOL_ACTIVITY_KIND.READ,
      toolName: fileTool.toolName,
      path: event.path,
    }
  if (
    fileTool?.effect === TOOL_EFFECT.WRITE &&
    event.kind === TOOL_ACTIVITY_KIND.EDIT
  )
    return {
      ...common,
      ...sessionCapability,
      kind: TOOL_ACTIVITY_KIND.EDIT,
      toolName: fileTool.toolName,
      path: event.path,
    }
}

function toRunEvent(value: unknown): AgentRunEventVo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSessionApiError(
      'Agent 返回了无效的流式事件。',
      'INVALID_STREAM_RESPONSE',
    )
  }

  const event = value as Record<string, unknown>
  switch (event.type) {
    case AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED:
    case AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA:
      return parseTraceUpdate(event)
    case AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED:
      return { type: AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED }
    case AGENT_RUN_EVENT_TYPE.START:
      if (
        typeof event.sessionId === 'string' &&
        isToolPermission(event.permission)
      ) {
        return {
          permission: event.permission,
          ...(Array.isArray(event.mcpUnavailable) &&
          event.mcpUnavailable.every((item) => typeof item === 'string')
            ? { mcpUnavailable: event.mcpUnavailable as string[] }
            : {}),
          sessionId: event.sessionId,
          type: AGENT_RUN_EVENT_TYPE.START,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.STEERING_APPLIED:
      if (
        typeof event.content === 'string' &&
        typeof event.entryId === 'string' &&
        event.entryId
      ) {
        return {
          content: event.content,
          entryId: event.entryId,
          type: AGENT_RUN_EVENT_TYPE.STEERING_APPLIED,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.TEXT_DELTA:
    case AGENT_RUN_EVENT_TYPE.REASONING_DELTA:
      if (typeof event.delta === 'string') {
        return { delta: event.delta, type: event.type }
      }
      break
    case AGENT_RUN_EVENT_TYPE.TODO_UPDATED: {
      const todos = todoItems(event.todos)
      if (todos) return { todos, type: AGENT_RUN_EVENT_TYPE.TODO_UPDATED }
      break
    }
    case AGENT_RUN_EVENT_TYPE.CONTEXT_USAGE_UPDATED: {
      const parsed = contextUsage(event.contextUsage)
      if (parsed)
        return {
          contextUsage: parsed,
          type: AGENT_RUN_EVENT_TYPE.CONTEXT_USAGE_UPDATED,
        }
      break
    }
    case AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_STARTED:
      if (
        typeof event.activityId === 'string' &&
        event.activityId &&
        Number.isSafeInteger(event.beforeTokens) &&
        (event.beforeTokens as number) >= 0 &&
        Number.isSafeInteger(event.inputLimit) &&
        (event.inputLimit as number) > 0 &&
        Number.isSafeInteger(event.startedAt) &&
        (event.startedAt as number) >= 0
      )
        return {
          activityId: event.activityId,
          beforeTokens: event.beforeTokens as number,
          inputLimit: event.inputLimit as number,
          startedAt: event.startedAt as number,
          type: AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_STARTED,
        }
      break
    case AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_COMPLETED: {
      const status = event.status
      if (
        typeof event.activityId !== 'string' ||
        !event.activityId ||
        !Number.isSafeInteger(event.beforeTokens) ||
        (event.beforeTokens as number) < 0 ||
        !Number.isSafeInteger(event.completedAt) ||
        (event.completedAt as number) < 0 ||
        !Number.isSafeInteger(event.inputLimit) ||
        (event.inputLimit as number) < 1 ||
        !Number.isSafeInteger(event.startedAt) ||
        (event.startedAt as number) < 0 ||
        (status !== CONTEXT_COMPACTION_STATUS.COMPLETED &&
          status !== CONTEXT_COMPACTION_STATUS.FAILED &&
          status !== CONTEXT_COMPACTION_STATUS.ABORTED)
      )
        break
      const optionalToken = (key: string) =>
        event[key] === undefined ||
        (Number.isSafeInteger(event[key]) && (event[key] as number) >= 0)
      if (!optionalToken('afterTokens') || !optionalToken('reclaimedTokens'))
        break
      if (event.errorCode !== undefined && typeof event.errorCode !== 'string')
        break
      return {
        activityId: event.activityId,
        ...(event.afterTokens === undefined
          ? {}
          : { afterTokens: event.afterTokens as number }),
        beforeTokens: event.beforeTokens as number,
        completedAt: event.completedAt as number,
        ...(typeof event.errorCode === 'string'
          ? { errorCode: event.errorCode }
          : {}),
        inputLimit: event.inputLimit as number,
        ...(event.reclaimedTokens === undefined
          ? {}
          : { reclaimedTokens: event.reclaimedTokens as number }),
        status,
        startedAt: event.startedAt as number,
        type: AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_COMPLETED,
      }
    }
    case AGENT_RUN_EVENT_TYPE.TOOL_START:
      if (
        typeof event.toolCallId === 'string' &&
        typeof event.toolName === 'string' &&
        isToolActivityKind(event.kind)
      ) {
        return {
          input: event.input,
          ...(typeof event.label === 'string' ? { label: event.label } : {}),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          kind: event.kind,
          type: AGENT_RUN_EVENT_TYPE.TOOL_START,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.TOOL_END:
      if (
        typeof event.toolCallId === 'string' &&
        typeof event.toolName === 'string' &&
        isToolActivityKind(event.kind) &&
        typeof event.isError === 'boolean'
      ) {
        return {
          isError: event.isError,
          ...(typeof event.executionId === 'string'
            ? { executionId: event.executionId }
            : {}),
          ...(typeof event.filePath === 'string'
            ? { filePath: event.filePath }
            : {}),
          ...(event.toolName === POLICY_TOOL.BASH.toolName
            ? { outcome: bashOutcome(event.outcome) }
            : {}),
          output: event.output,
          ...(typeof event.label === 'string' ? { label: event.label } : {}),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          kind: event.kind,
          ...(event.running === true ? { running: true as const } : {}),
          type: AGENT_RUN_EVENT_TYPE.TOOL_END,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED: {
      const approval = parseToolApproval(event)
      if (approval) return approval
      break
    }
    case AGENT_RUN_EVENT_TYPE.USAGE:
      if (
        ['cacheRead', 'cacheWrite', 'input', 'output', 'total'].every(
          (key) => typeof event[key] === 'number',
        )
      ) {
        return {
          cacheRead: event.cacheRead as number,
          cacheWrite: event.cacheWrite as number,
          input: event.input as number,
          output: event.output as number,
          total: event.total as number,
          type: AGENT_RUN_EVENT_TYPE.USAGE,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.DONE:
      if (
        typeof event.entryId === 'string' &&
        typeof event.stopReason === 'string'
      ) {
        return {
          entryId: event.entryId,
          stopReason: event.stopReason,
          type: AGENT_RUN_EVENT_TYPE.DONE,
        }
      }
      break
    case AGENT_RUN_EVENT_TYPE.ERROR:
      if (typeof event.code === 'string' && typeof event.message === 'string') {
        return {
          code: event.code,
          message: event.message,
          type: AGENT_RUN_EVENT_TYPE.ERROR,
        }
      }
      break
  }

  throw new AgentSessionApiError(
    'Agent 返回了无效的流式事件。',
    'INVALID_STREAM_RESPONSE',
  )
}

/** 解析完整 SSE frame，并保留可能跨网络 chunk 的尾部半包。 */
export function parseAgentSseFrames(source: string): ParsedSseFrames {
  const events: AgentRunEventVo[] = []
  let remainder = source
  let boundary = remainder.match(/\r?\n\r?\n/u)

  while (boundary?.index !== undefined) {
    const frame = remainder.slice(0, boundary.index)
    remainder = remainder.slice(boundary.index + boundary[0].length)
    const data = frame
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')

    if (data) {
      try {
        events.push(toRunEvent(JSON.parse(data)))
      } catch (error) {
        if (error instanceof AgentSessionApiError) throw error
        throw new AgentSessionApiError(
          'Agent 返回了无法解析的流式事件。',
          'INVALID_STREAM_RESPONSE',
        )
      }
    }
    boundary = remainder.match(/\r?\n\r?\n/u)
  }

  return { events, remainder }
}

export const listAgentSessions = () =>
  request<AgentSessionVo[]>('/api/agent/sessions')

const toolExecutionStates = new Set([
  TOOL_EXECUTION_STATE.FAILED,
  TOOL_EXECUTION_STATE.INTERRUPTED,
  TOOL_EXECUTION_STATE.RUNNING,
  TOOL_EXECUTION_STATE.STOPPED,
  TOOL_EXECUTION_STATE.STOPPING,
  TOOL_EXECUTION_STATE.SUCCEEDED,
])

/** 校验独立执行 SSE/HTTP 快照，避免把任意服务端对象注入控制台。 */
export const parseToolExecution = (
  value: unknown,
): ToolExecutionVo | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const execution = value as Record<string, unknown>
  if (execution.service !== undefined) {
    if (
      !execution.service ||
      typeof execution.service !== 'object' ||
      Array.isArray(execution.service)
    )
      return
    const service = execution.service as Record<string, unknown>
    if (
      typeof service.command !== 'string' ||
      !service.command.trim() ||
      service.command.includes('\0') ||
      typeof service.cwd !== 'string' ||
      !service.cwd ||
      service.cwd.includes('\0')
    )
      return
    if (
      service.removedAt !== undefined &&
      (!Number.isSafeInteger(service.removedAt) ||
        (service.removedAt as number) < 0 ||
        execution.state === TOOL_EXECUTION_STATE.RUNNING ||
        execution.state === TOOL_EXECUTION_STATE.STOPPING ||
        execution.canRestart !== false ||
        execution.canStop !== false)
    )
      return
  }
  if (
    typeof execution.background !== 'boolean' ||
    typeof execution.canRestart !== 'boolean' ||
    typeof execution.canStop !== 'boolean' ||
    typeof execution.executionId !== 'string' ||
    typeof execution.label !== 'string' ||
    typeof execution.runId !== 'string' ||
    typeof execution.sessionId !== 'string' ||
    !Number.isSafeInteger(execution.startedAt) ||
    !toolExecutionStates.has(execution.state as never) ||
    typeof execution.toolCallId !== 'string' ||
    typeof execution.toolName !== 'string' ||
    (execution.completedAt !== undefined &&
      !Number.isSafeInteger(execution.completedAt)) ||
    (execution.error !== undefined && typeof execution.error !== 'string') ||
    (execution.output !== undefined && typeof execution.output !== 'string') ||
    (execution.previousExecutionId !== undefined &&
      typeof execution.previousExecutionId !== 'string')
  )
    return
  return execution as unknown as ToolExecutionVo
}

export const listToolExecutions = async (sessionId: string) => {
  const value = await request<unknown>(executionPath(sessionId))
  if (!Array.isArray(value))
    throw new AgentSessionApiError(
      '工具执行列表无效。',
      'INVALID_TOOL_EXECUTION_RESPONSE',
    )
  const executions = value.map(parseToolExecution)
  if (executions.some((execution) => execution === undefined))
    throw new AgentSessionApiError(
      '工具执行列表无效。',
      'INVALID_TOOL_EXECUTION_RESPONSE',
    )
  return executions as ToolExecutionVo[]
}

export const readToolExecutionOutput = async (
  sessionId: string,
  executionId: string,
  offset = 0,
  limit = 64 * 1024,
) => {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  const value = await request<unknown>(
    `${executionPath(sessionId, executionId)}/output?${query}`,
  )
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentSessionApiError(
      '工具输出响应无效。',
      'INVALID_TOOL_OUTPUT_RESPONSE',
    )
  const output = value as Record<string, unknown>
  if (
    typeof output.text !== 'string' ||
    !Number.isSafeInteger(output.offset) ||
    !Number.isSafeInteger(output.totalBytes) ||
    typeof output.truncated !== 'boolean' ||
    (output.nextOffset !== null && !Number.isSafeInteger(output.nextOffset))
  )
    throw new AgentSessionApiError(
      '工具输出响应无效。',
      'INVALID_TOOL_OUTPUT_RESPONSE',
    )
  return output as unknown as ToolExecutionOutputVo
}

const mutateToolExecution = async (
  sessionId: string,
  executionId: string,
  action: ToolExecutionAction,
) => {
  const removing = action === TOOL_EXECUTION_ACTION.REMOVE_SERVICE
  const value = await request<unknown>(
    `${executionPath(sessionId, executionId)}/${removing ? 'service' : action}`,
    { method: removing ? 'DELETE' : 'POST' },
  )
  const execution = parseToolExecution(value)
  if (!execution)
    throw new AgentSessionApiError(
      '工具执行响应无效。',
      'INVALID_TOOL_EXECUTION_RESPONSE',
    )
  return execution
}

export const stopToolExecution = (sessionId: string, executionId: string) =>
  mutateToolExecution(sessionId, executionId, TOOL_EXECUTION_ACTION.STOP)

export const restartToolExecution = (sessionId: string, executionId: string) =>
  mutateToolExecution(sessionId, executionId, TOOL_EXECUTION_ACTION.RESTART)

/** 停止并移除服务入口，保留工具执行记录和日志。 */
export const removeToolExecutionService = (
  sessionId: string,
  executionId: string,
) =>
  mutateToolExecution(
    sessionId,
    executionId,
    TOOL_EXECUTION_ACTION.REMOVE_SERVICE,
  )

/** 使用原生 EventSource 接收独立执行变化；每次重连由服务端先发权威快照。 */
export const subscribeToolExecutions = (
  sessionId: string,
  handlers: {
    onError(): void
    onExecution(execution: ToolExecutionVo): void
    onSnapshot(executions: ToolExecutionVo[]): void
  },
) => {
  let source: EventSource | undefined
  let disposed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const connect = () => {
    const connection = new EventSource(`${executionPath(sessionId)}/stream`)
    source = connection
    connection.addEventListener(
      TOOL_EXECUTION_EVENT_TYPE.SNAPSHOT,
      (event: MessageEvent<string>) => {
        if (disposed || connection !== source) return
        try {
          const value = JSON.parse(event.data) as { executions?: unknown }
          if (!Array.isArray(value.executions)) throw new Error()
          const executions = value.executions.map(parseToolExecution)
          if (executions.some((execution) => execution === undefined))
            throw new Error()
          handlers.onSnapshot(executions as ToolExecutionVo[])
        } catch {
          handlers.onError()
        }
      },
    )
    connection.addEventListener(
      TOOL_EXECUTION_EVENT_TYPE.EXECUTION,
      (event: MessageEvent<string>) => {
        if (disposed || connection !== source) return
        try {
          const value = JSON.parse(event.data) as { execution?: unknown }
          const execution = parseToolExecution(value.execution)
          if (!execution) throw new Error()
          handlers.onExecution(execution)
        } catch {
          handlers.onError()
        }
      },
    )
    connection.onerror = () => {
      if (disposed || connection !== source) return
      handlers.onError()
      // CONNECTING 由浏览器重连；HTTP 错误后的 CLOSED 需要重新创建连接。
      if (connection.readyState !== EventSource.CLOSED || retry !== undefined)
        return
      retry = setTimeout(() => {
        retry = undefined
        if (!disposed) connect()
      }, 1000)
    }
  }
  connect()
  return () => {
    disposed = true
    if (retry !== undefined) clearTimeout(retry)
    source?.close()
  }
}

/** 永久删除一个会话及其持久化历史。 */
export const deleteAgentSession = (sessionId: string) =>
  request<void>(sessionPath(sessionId), { method: 'DELETE' })

/** 永久删除当前全部归档会话。 */
export const clearArchivedAgentSessions = () =>
  request<void>('/api/agent/sessions/archived', { method: 'DELETE' })

export const getAgentSession = (sessionId: string) =>
  request<AgentSessionDetailVo>(sessionPath(sessionId))

export const createAgentSession = (input: CreateAgentSessionInput) =>
  request<AgentSessionVo>('/api/agent/sessions', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

export const updateAgentSessionModel = (
  sessionId: string,
  input: UpdateAgentSessionModelInput,
) =>
  request<AgentSessionVo>(sessionPath(sessionId), {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })

export const updateAgentSessionArchived = (
  sessionId: string,
  input: UpdateAgentSessionArchiveInput,
) =>
  request<AgentSessionVo>(sessionPath(sessionId), {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })

export const renameAgentSession = (
  sessionId: string,
  input: RenameAgentSessionInput,
) =>
  request<AgentSessionVo>(sessionPath(sessionId), {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })

export const listAgentSessionMessages = (
  sessionId: string,
  before?: number,
) => {
  const query = new URLSearchParams({ limit: '200' })
  if (before !== undefined) query.set('before', String(before))
  return request<AgentSessionMessagePageVo>(
    `${sessionPath(sessionId)}/messages?${query}`,
  )
}

export const abortAgentSession = (sessionId: string) =>
  request<void>(`${sessionPath(sessionId)}/abort`, { method: 'POST' })

export const steerAgentSession = (sessionId: string, content: string) =>
  request<void>(`${sessionPath(sessionId)}/steer`, {
    body: JSON.stringify({ content }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

/** 查询断线或刷新后仍在等待的服务端工具审批。 */
export const getPendingToolApproval = async (
  sessionId: string,
): Promise<PendingToolApprovalVo | undefined> => {
  const value = await request<unknown>(
    `${sessionPath(sessionId)}/tool-approvals/pending`,
  )
  if (value === undefined) return
  const approval = parseToolApproval(value)
  if (!approval)
    throw new AgentSessionApiError(
      'Agent 返回了无效的审批响应。',
      'INVALID_APPROVAL_RESPONSE',
    )
  return approval
}

/** 决议服务端保存的原始工具调用，不允许客户端替换参数。 */
export const resolveToolApproval = (
  sessionId: string,
  approvalId: string,
  decision: ApprovalDecision,
) =>
  request<void>(
    `${sessionPath(sessionId)}/tool-approvals/${encodeURIComponent(approvalId)}`,
    {
      body: JSON.stringify({ decision }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  )

/** 持续解析 Agent SSE，并把跨网络分块的完整事件交给会话状态层。 */
async function consumeAgentEventStream(
  response: Response,
  onEvent: (event: AgentRunEventVo) => void,
) {
  if (!response.body) {
    throw new AgentSessionApiError(
      '浏览器没有收到 Agent 响应流。',
      'STREAM_UNAVAILABLE',
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let remainder = ''
  while (true) {
    const { done, value } = await reader.read()
    remainder += decoder.decode(value, { stream: !done })
    const parsed = parseAgentSseFrames(remainder)
    remainder = parsed.remainder
    parsed.events.forEach(onEvent)
    if (done) break
  }
  if (remainder.trim()) {
    parseAgentSseFrames(`${remainder}\n\n`).events.forEach(onEvent)
  }
}

/** 重新订阅页面刷新后仍在后台执行的活跃 Run。 */
export async function reconnectAgentRun(
  sessionId: string,
  onEvent: (event: AgentRunEventVo) => void,
): Promise<ReconnectedAgentRun | undefined> {
  const response = await fetch(`${sessionPath(sessionId)}/events/stream`, {
    headers: { accept: 'text/event-stream' },
  })
  if (response.status === 204) return undefined
  if (!response.ok) {
    throw new AgentSessionApiError(
      `请求失败（${response.status}）`,
      'AGENT_REQUEST_FAILED',
      response.status,
    )
  }
  return { completed: consumeAgentEventStream(response, onEvent) }
}

/** 消费 POST SSE；EventSource 不支持 POST，因此直接使用浏览器流。 */
export async function streamAgentMessage(
  sessionId: string,
  input: StreamAgentMessageInput,
  onEvent: (event: AgentRunEventVo) => void,
) {
  const request = {
    ...(input.commandId ? { commandId: input.commandId } : {}),
    content: input.content,
    permission: input.permission,
    ...(input.skillIds.length ? { skillIds: input.skillIds } : {}),
    ...(input.mcpServerIds?.length ? { mcpServerIds: input.mcpServerIds } : {}),
    ...(input.pluginIds?.length ? { pluginIds: input.pluginIds } : {}),
    thinkingLevel: input.thinkingLevel,
  }
  const body = input.attachments.length
    ? (() => {
        const form = new FormData()
        form.set('request', JSON.stringify(request))
        input.attachments.forEach((file) => form.append('attachments', file))
        return form
      })()
    : JSON.stringify(request)
  const response = await fetch(`${sessionPath(sessionId)}/messages/stream`, {
    body,
    ...(typeof body === 'string'
      ? { headers: { 'content-type': 'application/json' } }
      : {}),
    method: 'POST',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined
    throw new AgentSessionApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code ?? 'AGENT_REQUEST_FAILED',
      response.status,
    )
  }
  await consumeAgentEventStream(response, onEvent)
}
