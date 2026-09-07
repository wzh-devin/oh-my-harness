import type { PermissionId } from '../../../settings/index.ts'

export interface AgentSessionVo {
  archived: boolean
  createdAt: number
  id: string
  modelId: string
  name: null | string
  providerId: string
  workspaceId: null | string
}

export interface ContextUsageVo {
  contextWindow: number
  messageTokens: number
  modelId: string
  providerId: string
  systemTokens: number
  toolsTokens: number
  usedTokens: number
}

export interface AgentSessionDetailVo extends AgentSessionVo {
  pluginIds: string[]
  contextUsage?: ContextUsageVo
  stats: {
    cachedTokens: number
    costTotal: number
    messageCount: number
    totalTokens: number
    uncachedTokens: number
  }
}

export interface AgentSessionMessageVo {
  attachments?: AgentSessionMessageAttachmentVo[]
  content: string
  contextItems?: AgentSessionMessageContextItemVo[]
  entryId: string
  parts?: AgentSessionMessagePartVo[]
  reasoning?: string
  role: 'assistant' | 'user'
  seq: number
  stopReason?: string
  timestamp: number
  tools?: AgentSessionToolVo[]
}

export interface AgentSessionToolVo {
  errorText?: string
  input: Record<string, unknown>
  kind: 'command' | 'edit' | 'read' | 'skill' | 'tool'
  outcome?: BashOutcomeVo
  output?: string
  state: 'input-available' | 'output-available' | 'output-error'
  toolCallId: string
  toolName: string
}

export interface BashOutcomeVo {
  exitCode: number | null
  outputExceeded: boolean
  signal: string | null
  timedOut: boolean
}

export type AgentSessionMessagePartVo =
  | { reasoning: string; type: 'reasoning' }
  | { text: string; type: 'text' }
  | { tool: AgentSessionToolVo; type: 'tool' }

export interface AgentSessionMessagePageVo {
  items: AgentSessionMessageVo[]
  nextCursor: number | null
  todos?: AgentTodoItemVo[]
}

export interface AgentTodoItemVo {
  content: string
  status: 'completed' | 'in_progress' | 'pending'
}

export type AgentRunEventVo =
  | import('../../../trace/api/agent-trace-api.ts').AgentTraceUpdate
  | { permission: PermissionId; sessionId: string; type: 'start' }
  | { type: 'trajectory_changed' }
  | { delta: string; type: 'text_delta' | 'reasoning_delta' }
  | { todos: AgentTodoItemVo[]; type: 'todo_updated' }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      type: 'tool_start'
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcomeVo
      output: unknown
      toolCallId: string
      toolName: string
      type: 'tool_end'
    }
  | {
      approvalId: string
      kind: 'edit' | 'read'
      path: string
      title: string
      toolCallId: string
      toolName: 'edit' | 'read' | 'write'
      type: 'tool_approval_required'
    }
  | {
      approvalId: string
      input: { command: string }
      kind: 'command'
      title: string
      toolCallId: string
      toolName: 'bash'
      type: 'tool_approval_required'
    }
  | {
      approvalId: string
      input: {
        connectionId: string
        tool: string
        arguments: Record<string, unknown>
      }
      kind: 'mcp'
      title: string
      toolCallId: string
      toolName: 'mcp'
      type: 'tool_approval_required'
    }
  | {
      cacheRead: number
      cacheWrite: number
      contextUsage?: ContextUsageVo
      input: number
      output: number
      total: number
      type: 'usage'
    }
  | { entryId: string; stopReason: string; type: 'done' }
  | { code: string; message: string; type: 'error' }

export type PendingToolApprovalVo = Extract<
  AgentRunEventVo,
  { type: 'tool_approval_required' }
>

export interface AgentSessionMessageAttachmentVo {
  id: string
  mimeType: string
  name: string
  size: number
  src?: string
}

export interface AgentSessionMessageContextItemVo {
  description: string
  id: string
  kind: 'command' | 'skill' | 'plugin'
  label: string
  reference: string
  sourceId: string
}
