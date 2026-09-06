import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type { BashOutcome, TodoItem } from '@oh-my-harness/agent-tools'

import type { ContextUsageSnapshot } from './context-usage.ts'

export type AgentRuntimeEvent =
  | { permission: ToolPermission; sessionId: string; type: 'start' }
  | { delta: string; type: 'text_delta' }
  | { delta: string; type: 'reasoning_delta' }
  | { todos: TodoItem[]; type: 'todo_updated' }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      type: 'tool_start'
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcome
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
      contextUsage?: ContextUsageSnapshot
      input: number
      output: number
      total: number
      type: 'usage'
    }
  | {
      entryId: string
      stopReason: 'deferred' | 'length' | 'stop' | 'toolUse'
      type: 'done'
    }
  | { code: string; message: string; type: 'error' }

export interface AgentRun {
  /** 停止向已断开的消费者缓存事件，不会中止后台 Agent。 */
  detach(): void
  events: AsyncIterable<AgentRuntimeEvent>
}
