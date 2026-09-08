import type { ToolActivityKind } from '@oh-my-harness/agent-runtime'
import type { POLICY_TOOL } from '@oh-my-harness/agent-policy/contracts'
import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type {
  AgentRunAttachment,
  ModelThinkingLevel,
} from '@oh-my-harness/agent-runtime'
import {
  AGENT_RUN_EVENT_TYPE,
  TOOL_ACTIVITY_KIND,
  type TodoStatus,
  type TrajectoryStreamBlock,
} from '@oh-my-harness/shared'

import type {
  ContextUsageDto,
  AgentTrajectoryDto,
  AgentTrajectoryRecordDetailDto,
} from './session-dto.ts'

export interface BashOutcomeDto {
  exitCode: number | null
  outputExceeded: boolean
  signal: string | null
  timedOut: boolean
}

export interface SendAgentMessageDto {
  attachments?: readonly AgentRunAttachment[]
  commandId?: string
  content: string
  permission: ToolPermission
  skillIds?: readonly string[]
  pluginIds?: readonly string[]
  thinkingLevel?: ModelThinkingLevel
}

export type AgentRunEventDto =
  | {
      type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED
      trajectory: Omit<AgentTrajectoryDto, 'records'>
      records: AgentTrajectoryRecordDetailDto[]
    }
  | {
      type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA
      cursor: AgentTrajectoryDto['cursor']
      id: string
      block: TrajectoryStreamBlock
      delta: string
    }
  | {
      permission: ToolPermission
      sessionId: string
      type: typeof AGENT_RUN_EVENT_TYPE.START
    }
  | { type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED }
  | { delta: string; type: typeof AGENT_RUN_EVENT_TYPE.TEXT_DELTA }
  | { delta: string; type: typeof AGENT_RUN_EVENT_TYPE.REASONING_DELTA }
  | {
      todos: {
        content: string
        status: TodoStatus
      }[]
      type: typeof AGENT_RUN_EVENT_TYPE.TODO_UPDATED
    }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      kind: ToolActivityKind
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_START
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcomeDto
      output: unknown
      toolCallId: string
      toolName: string
      kind: ToolActivityKind
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
      contextUsage?: ContextUsageDto
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
