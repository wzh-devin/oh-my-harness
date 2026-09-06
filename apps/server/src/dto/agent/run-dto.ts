import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type {
  AgentRunAttachment,
  ModelThinkingLevel,
} from '@oh-my-harness/agent-runtime'

import type { ContextUsageDto } from './session-dto.ts'

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
  thinkingLevel?: ModelThinkingLevel
}

export type AgentRunEventDto =
  | { permission: ToolPermission; sessionId: string; type: 'start' }
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
      type: 'tool_start'
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcomeDto
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
