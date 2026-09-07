import type {
  ToolActivityKind,
  ToolApprovalEvent,
} from './tool-presentation.ts'
import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type { BashOutcome, TodoItem } from '@oh-my-harness/agent-tools'

import type { ContextUsageSnapshot } from './context-usage.ts'
import type { TrajectoryUpdate } from '../trajectory/trajectory-stream.ts'

export type AgentRuntimeEvent =
  | TrajectoryUpdate
  | { permission: ToolPermission; sessionId: string; type: 'start' }
  | { type: 'trajectory_changed' }
  | { delta: string; type: 'text_delta' }
  | { delta: string; type: 'reasoning_delta' }
  | { todos: TodoItem[]; type: 'todo_updated' }
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
      outcome?: BashOutcome
      output: unknown
      toolCallId: string
      toolName: string
      kind: ToolActivityKind
      type: 'tool_end'
    }
  | ToolApprovalEvent
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
