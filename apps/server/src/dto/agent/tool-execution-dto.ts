import type {
  ToolExecutionOutput,
  ToolExecutionSnapshot,
} from '@oh-my-harness/agent-tools'
import { TOOL_EXECUTION_EVENT_TYPE } from '@oh-my-harness/shared'

export type ToolExecutionDto = ToolExecutionSnapshot
export type ToolExecutionOutputDto = ToolExecutionOutput

export type ToolExecutionEventDto =
  | {
      executions: ToolExecutionDto[]
      type: typeof TOOL_EXECUTION_EVENT_TYPE.SNAPSHOT
    }
  | {
      execution: ToolExecutionDto
      type: typeof TOOL_EXECUTION_EVENT_TYPE.EXECUTION
    }
