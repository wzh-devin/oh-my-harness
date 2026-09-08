import type { ToolActivityKind } from '@oh-my-harness/agent-runtime'
import {
  AGENT_TRAJECTORY_LANE,
  AGENT_TRAJECTORY_RECORD_KIND,
  MESSAGE_PART_TYPE,
  type AgentContextKind,
  type AgentTrajectoryLane,
  type AgentTrajectoryRecordKind,
  type AgentTrajectoryStatus,
  type MessageRole,
  type SessionToolState,
  type TodoStatus,
} from '@oh-my-harness/shared'
export interface CreateAgentSessionDto {
  modelId: string
  name?: string
  providerId: string
  workspaceId: string
}

export type UpdateAgentSessionDto =
  | { archived: boolean }
  | { name: null | string }
  | { modelId: string; providerId: string }

export interface AgentSessionDto {
  archived: boolean
  createdAt: number
  id: string
  modelId: string
  name: null | string
  providerId: string
  workspaceId: null | string
}

export interface ContextUsageDto {
  contextWindow: number
  messageTokens: number
  modelId: string
  providerId: string
  systemTokens: number
  toolsTokens: number
  usedTokens: number
}

export interface AgentSessionDetailDto extends AgentSessionDto {
  pluginIds: string[]
  contextUsage?: ContextUsageDto
  stats: {
    cachedTokens: number
    costTotal: number
    messageCount: number
    totalTokens: number
    uncachedTokens: number
  }
}

export interface AgentSessionMessageDto {
  attachments?: AgentSessionMessageAttachmentDto[]
  content: string
  contextItems?: AgentSessionMessageContextItemDto[]
  entryId: string
  parts?: AgentSessionMessagePartDto[]
  reasoning?: string
  role: MessageRole
  seq: number
  stopReason?: string
  timestamp: number
  tools?: AgentSessionToolDto[]
}

export interface AgentSessionToolDto {
  errorText?: string
  input: Record<string, unknown>
  kind: ToolActivityKind
  outcome?: {
    exitCode: number | null
    outputExceeded: boolean
    signal: string | null
    timedOut: boolean
  }
  output?: string
  state: SessionToolState
  toolCallId: string
  toolName: string
}

export type AgentSessionMessagePartDto =
  | { reasoning: string; type: typeof MESSAGE_PART_TYPE.REASONING }
  | { text: string; type: typeof MESSAGE_PART_TYPE.TEXT }
  | { tool: AgentSessionToolDto; type: typeof MESSAGE_PART_TYPE.TOOL }

export interface AgentSessionMessagePageDto {
  items: AgentSessionMessageDto[]
  nextCursor: number | null
  todos?: AgentTodoItemDto[]
}

export interface AgentTodoItemDto {
  content: string
  status: TodoStatus
}

export interface AgentSessionMessageAttachmentDto {
  id: string
  mimeType: string
  name: string
  size: number
  src?: string
}

export interface AgentSessionMessageContextItemDto {
  description: string
  id: string
  kind: AgentContextKind
  label: string
  reference: string
  sourceId: string
}

interface AgentTrajectoryRecordDtoBase {
  position: number
  runId: string
  runNumber: number
  sourceRecordId?: string
  resultRecordId?: string
  preview?: string
  source?: string
  detail?: Readonly<Record<string, unknown>>
  completedAt?: number
  durationMs: number
  id: string
  kind: AgentTrajectoryRecordKind
  label: string
  lane: AgentTrajectoryLane
  request?: number
  startedAt: number
  status: AgentTrajectoryStatus
  summary: string
  turn: number
}

export type AgentTrajectoryRecordDto = AgentTrajectoryRecordDtoBase &
  (
    | {
        kind:
          | typeof AGENT_TRAJECTORY_RECORD_KIND.SYSTEM
          | typeof AGENT_TRAJECTORY_RECORD_KIND.CONTEXT
          | typeof AGENT_TRAJECTORY_RECORD_KIND.USER
        lane: typeof AGENT_TRAJECTORY_LANE.INPUT
      }
    | {
        kind:
          | typeof AGENT_TRAJECTORY_RECORD_KIND.REQUEST
          | typeof AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT
        lane: typeof AGENT_TRAJECTORY_LANE.MODEL
        request: number
        sourceRecordId: string
      }
    | {
        kind: typeof AGENT_TRAJECTORY_RECORD_KIND.TOOL
        lane: typeof AGENT_TRAJECTORY_LANE.TOOLS
        request: number
        sourceRecordId: string
      }
  )

export type AgentTrajectoryRecordDetailDto = AgentTrajectoryRecordDto & {
  detail: Readonly<Record<string, unknown>>
  preview: string
  raw: Readonly<Record<string, unknown>>
  source: string
}

export interface AgentTrajectorySearchDto {
  recordIds: string[]
  cursor: { sequence: number; revision: number }
}

export interface AgentTrajectoryDto {
  completedAt?: number
  durationMs: number
  model: string
  records: AgentTrajectoryRecordDto[]
  requestCount: number
  sessionId: string
  cursor: { sequence: number; revision: number }
  runs: {
    runId: string
    number: number
    startedAt: number
    completedAt?: number
    status: AgentTrajectoryRecordDto['status']
  }[]
  startedAt: number
  turnCount: number
}
