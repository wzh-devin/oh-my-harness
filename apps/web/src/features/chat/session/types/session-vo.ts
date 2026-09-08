import type { POLICY_TOOL } from '@oh-my-harness/agent-policy/contracts'
import type { PermissionId } from '../../../settings/index.ts'
import {
  AGENT_RUN_EVENT_TYPE,
  MESSAGE_PART_TYPE,
  TOOL_ACTIVITY_KIND,
  type AgentContextKind,
  type MessageRole,
  type SessionToolState,
  type TodoStatus,
  type ToolActivityKind,
} from '@oh-my-harness/shared'

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
  role: MessageRole
  seq: number
  stopReason?: string
  timestamp: number
  tools?: AgentSessionToolVo[]
}

export interface AgentSessionToolVo {
  errorText?: string
  input: Record<string, unknown>
  kind: Exclude<ToolActivityKind, typeof TOOL_ACTIVITY_KIND.MCP>
  outcome?: BashOutcomeVo
  output?: string
  state: SessionToolState
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
  | { reasoning: string; type: typeof MESSAGE_PART_TYPE.REASONING }
  | { text: string; type: typeof MESSAGE_PART_TYPE.TEXT }
  | { tool: AgentSessionToolVo; type: typeof MESSAGE_PART_TYPE.TOOL }

export interface AgentSessionMessagePageVo {
  items: AgentSessionMessageVo[]
  nextCursor: number | null
  todos?: AgentTodoItemVo[]
}

export interface AgentTodoItemVo {
  content: string
  status: TodoStatus
}

export type AgentRunEventVo =
  | import('../../../trace/api/agent-trace-api.ts').AgentTraceUpdate
  | {
      permission: PermissionId
      sessionId: string
      type: typeof AGENT_RUN_EVENT_TYPE.START
    }
  | { type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED }
  | {
      delta: string
      type:
        | typeof AGENT_RUN_EVENT_TYPE.TEXT_DELTA
        | typeof AGENT_RUN_EVENT_TYPE.REASONING_DELTA
    }
  | {
      todos: AgentTodoItemVo[]
      type: typeof AGENT_RUN_EVENT_TYPE.TODO_UPDATED
    }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      kind: AgentSessionToolVo['kind']
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_START
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcomeVo
      output: unknown
      toolCallId: string
      toolName: string
      kind: AgentSessionToolVo['kind']
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_END
    }
  | ({
      approvalId: string
      path: string
      title: string
      toolCallId: string
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED
    } & (
      | {
          kind: typeof TOOL_ACTIVITY_KIND.READ
          toolName: typeof POLICY_TOOL.READ.toolName
        }
      | {
          kind: typeof TOOL_ACTIVITY_KIND.EDIT
          toolName:
            typeof POLICY_TOOL.WRITE.toolName | typeof POLICY_TOOL.EDIT.toolName
        }
    ))
  | {
      approvalId: string
      input: { command: string }
      kind: typeof TOOL_ACTIVITY_KIND.COMMAND
      title: string
      toolCallId: string
      toolName: typeof POLICY_TOOL.BASH.toolName
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED
    }
  | {
      approvalId: string
      input: {
        connectionId: string
        tool: string
        arguments: Record<string, unknown>
      }
      kind: typeof TOOL_ACTIVITY_KIND.MCP
      title: string
      toolCallId: string
      toolName: typeof POLICY_TOOL.MCP.toolName
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED
    }
  | {
      cacheRead: number
      cacheWrite: number
      contextUsage?: ContextUsageVo
      input: number
      output: number
      total: number
      type: typeof AGENT_RUN_EVENT_TYPE.USAGE
    }
  | {
      entryId: string
      stopReason: string
      type: typeof AGENT_RUN_EVENT_TYPE.DONE
    }
  | {
      code: string
      message: string
      type: typeof AGENT_RUN_EVENT_TYPE.ERROR
    }

export type PendingToolApprovalVo = Extract<
  AgentRunEventVo,
  { type: typeof AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED }
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
  kind: AgentContextKind
  label: string
  reference: string
  sourceId: string
}
