import type { ToolActivityKind } from '@oh-my-harness/agent-runtime'
import type { POLICY_TOOL } from '@oh-my-harness/agent-policy/contracts'
import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type {
  AgentRunAttachment,
  ModelThinkingLevel,
} from '@oh-my-harness/agent-runtime'

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
      type: 'trajectory_updated'
      trajectory: Omit<AgentTrajectoryDto, 'records'>
      records: AgentTrajectoryRecordDetailDto[]
    }
  | {
      type: 'trajectory_delta'
      cursor: AgentTrajectoryDto['cursor']
      id: string
      block: 'text' | 'thinking'
      delta: string
    }
  | { permission: ToolPermission; sessionId: string; type: 'start' }
  | { type: 'trajectory_changed' }
  | { delta: string; type: 'text_delta' }
  | { delta: string; type: 'reasoning_delta' }
  | {
      todos: {
        content: string
        status: 'completed' | 'in_progress' | 'pending'
      }[]
      type: 'todo_updated'
    }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      kind: ToolActivityKind
      type: 'tool_start'
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcomeDto
      output: unknown
      toolCallId: string
      toolName: string
      kind: ToolActivityKind
      type: 'tool_end'
    }
  | ({
      approvalId: string
      path: string
      title: string
      toolCallId: string
      type: 'tool_approval_required'
    } & (
      | { kind: 'read'; toolName: typeof POLICY_TOOL.read.toolName }
      | {
          kind: 'edit'
          toolName:
            typeof POLICY_TOOL.write.toolName | typeof POLICY_TOOL.edit.toolName
        }
    ))
  | {
      approvalId: string
      input: { command: string }
      kind: 'command'
      title: string
      toolCallId: string
      toolName: typeof POLICY_TOOL.bash.toolName
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
      toolName: typeof POLICY_TOOL.mcp.toolName
      type: 'tool_approval_required'
    }
  | {
      cacheRead: number
      cacheWrite: number
      contextUsage?: ContextUsageDto
      input: number
      output: number
      total: number
      type: 'usage'
    }
  | {
      entryId: string
      stopReason: string
      type: 'done'
    }
  | { code: string; message: string; type: 'error' }
