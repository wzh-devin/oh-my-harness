import { parseTraceUpdate } from '../../../trace/api/index.ts'
import type {
  AgentRunEventVo,
  AgentSessionDetailVo,
  AgentSessionMessagePageVo,
  AgentSessionVo,
  AgentTodoItemVo,
  BashOutcomeVo,
  ContextUsageVo,
  PendingToolApprovalVo,
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
      (item.status !== 'pending' &&
        item.status !== 'in_progress' &&
        item.status !== 'completed') ||
      seen.has(content)
    ) {
      return
    }
    seen.add(content)
    if (item.status === 'in_progress' && ++activeCount > 1) return
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

function toRunEvent(value: unknown): AgentRunEventVo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSessionApiError(
      'Agent 返回了无效的流式事件。',
      'INVALID_STREAM_RESPONSE',
    )
  }

  const event = value as Record<string, unknown>
  switch (event.type) {
    case 'trajectory_updated':
    case 'trajectory_delta':
      return parseTraceUpdate(event)
    case 'trajectory_changed':
      return { type: 'trajectory_changed' }
    case 'start':
      if (
        typeof event.sessionId === 'string' &&
        (event.permission === 'read-only' ||
          event.permission === 'workspace-write' ||
          event.permission === 'full-access')
      ) {
        return {
          permission: event.permission,
          sessionId: event.sessionId,
          type: 'start',
        }
      }
      break
    case 'text_delta':
    case 'reasoning_delta':
      if (typeof event.delta === 'string') {
        return { delta: event.delta, type: event.type }
      }
      break
    case 'todo_updated': {
      const todos = todoItems(event.todos)
      if (todos) return { todos, type: 'todo_updated' }
      break
    }
    case 'tool_start':
      if (
        typeof event.toolCallId === 'string' &&
        typeof event.toolName === 'string'
      ) {
        return {
          input: event.input,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: 'tool_start',
        }
      }
      break
    case 'tool_end':
      if (
        typeof event.toolCallId === 'string' &&
        typeof event.toolName === 'string' &&
        typeof event.isError === 'boolean'
      ) {
        return {
          isError: event.isError,
          ...(typeof event.filePath === 'string'
            ? { filePath: event.filePath }
            : {}),
          ...(event.toolName === 'bash'
            ? { outcome: bashOutcome(event.outcome) }
            : {}),
          output: event.output,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: 'tool_end',
        }
      }
      break
    case 'tool_approval_required':
      if (
        typeof event.approvalId === 'string' &&
        event.kind === 'mcp' &&
        event.toolName === 'mcp' &&
        typeof event.title === 'string' &&
        typeof event.toolCallId === 'string' &&
        event.input &&
        typeof event.input === 'object'
      ) {
        const input = event.input as Record<string, unknown>
        if (
          typeof input.connectionId === 'string' &&
          typeof input.tool === 'string' &&
          input.arguments &&
          typeof input.arguments === 'object' &&
          !Array.isArray(input.arguments)
        )
          return {
            approvalId: event.approvalId,
            input: {
              connectionId: input.connectionId,
              tool: input.tool,
              arguments: input.arguments as Record<string, unknown>,
            },
            kind: 'mcp',
            title: event.title,
            toolCallId: event.toolCallId,
            toolName: 'mcp',
            type: 'tool_approval_required',
          }
      }
      if (
        typeof event.approvalId === 'string' &&
        event.kind === 'command' &&
        event.toolName === 'bash' &&
        typeof event.title === 'string' &&
        typeof event.toolCallId === 'string'
      ) {
        const input = bashInput(event.input)
        if (input) {
          return {
            approvalId: event.approvalId,
            input,
            kind: 'command',
            title: event.title,
            toolCallId: event.toolCallId,
            toolName: 'bash',
            type: 'tool_approval_required',
          }
        }
      }
      if (
        typeof event.approvalId === 'string' &&
        (event.kind === 'edit' || event.kind === 'read') &&
        typeof event.path === 'string' &&
        typeof event.title === 'string' &&
        typeof event.toolCallId === 'string' &&
        (event.toolName === 'edit' ||
          event.toolName === 'read' ||
          event.toolName === 'write')
      ) {
        return {
          approvalId: event.approvalId,
          kind: event.kind,
          path: event.path,
          title: event.title,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: 'tool_approval_required',
        }
      }
      break
    case 'usage':
      if (
        ['cacheRead', 'cacheWrite', 'input', 'output', 'total'].every(
          (key) => typeof event[key] === 'number',
        )
      ) {
        const parsedContextUsage =
          event.contextUsage === undefined
            ? undefined
            : contextUsage(event.contextUsage)
        if (event.contextUsage !== undefined && !parsedContextUsage) break
        return {
          cacheRead: event.cacheRead as number,
          cacheWrite: event.cacheWrite as number,
          ...(parsedContextUsage ? { contextUsage: parsedContextUsage } : {}),
          input: event.input as number,
          output: event.output as number,
          total: event.total as number,
          type: 'usage',
        }
      }
      break
    case 'done':
      if (
        typeof event.entryId === 'string' &&
        typeof event.stopReason === 'string'
      ) {
        return {
          entryId: event.entryId,
          stopReason: event.stopReason,
          type: 'done',
        }
      }
      break
    case 'error':
      if (typeof event.code === 'string' && typeof event.message === 'string') {
        return { code: event.code, message: event.message, type: 'error' }
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

/** 查询断线或刷新后仍在等待的服务端工具审批。 */
export const getPendingToolApproval = (sessionId: string) =>
  request<PendingToolApprovalVo | undefined>(
    `${sessionPath(sessionId)}/tool-approvals/pending`,
  )

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
    pluginIds: input.pluginIds ?? [],
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
