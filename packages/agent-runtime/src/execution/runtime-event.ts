import type {
  ToolActivityKind,
  ToolApprovalEvent,
} from './tool-presentation.ts'
import type { ToolPermission } from '@oh-my-harness/agent-policy'
import type { BashOutcome, TodoItem } from '@oh-my-harness/agent-tools'

import type { ContextUsageSnapshot } from './context-usage.ts'
import type {
  ContextCompactionCompleted,
  ContextCompactionStarted,
} from '../compaction/session-compaction.ts'
import type { TrajectoryUpdate } from '../trajectory/trajectory-stream.ts'
import {
  AGENT_RUN_EVENT_TYPE,
  type AgentRunStopReason,
} from '@oh-my-harness/shared'

export type AgentRuntimeEvent =
  | TrajectoryUpdate
  | {
      permission: ToolPermission
      sessionId: string
      mcpUnavailable?: string[]
      type: typeof AGENT_RUN_EVENT_TYPE.START
    }
  | {
      content: string
      entryId: string
      type: typeof AGENT_RUN_EVENT_TYPE.STEERING_APPLIED
    }
  | { type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED }
  | { delta: string; type: typeof AGENT_RUN_EVENT_TYPE.TEXT_DELTA }
  | { delta: string; type: typeof AGENT_RUN_EVENT_TYPE.REASONING_DELTA }
  | { todos: TodoItem[]; type: typeof AGENT_RUN_EVENT_TYPE.TODO_UPDATED }
  | (ContextCompactionStarted & {
      activityId: string
      type: typeof AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_STARTED
    })
  | (ContextCompactionCompleted & {
      type: typeof AGENT_RUN_EVENT_TYPE.CONTEXT_COMPACTION_COMPLETED
    })
  | {
      contextUsage: ContextUsageSnapshot
      type: typeof AGENT_RUN_EVENT_TYPE.CONTEXT_USAGE_UPDATED
    }
  | {
      input: unknown
      toolCallId: string
      toolName: string
      label?: string
      kind: ToolActivityKind
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_START
    }
  | {
      isError: boolean
      filePath?: string
      outcome?: BashOutcome
      output: unknown
      toolCallId: string
      toolName: string
      label?: string
      kind: ToolActivityKind
      type: typeof AGENT_RUN_EVENT_TYPE.TOOL_END
    }
  | ToolApprovalEvent
  | {
      cacheRead: number
      cacheWrite: number
      input: number
      output: number
      total: number
      type: typeof AGENT_RUN_EVENT_TYPE.USAGE
    }
  | {
      entryId: string
      stopReason: AgentRunStopReason
      type: typeof AGENT_RUN_EVENT_TYPE.DONE
    }
  | {
      code: string
      message: string
      type: typeof AGENT_RUN_EVENT_TYPE.ERROR
    }

export interface AgentRun {
  /** 停止向已断开的消费者缓存事件，不会中止后台 Agent。 */
  detach(): void
  events: AsyncIterable<AgentRuntimeEvent>
}
