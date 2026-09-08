export type { PlanStepState } from '@oh-my-harness/shared'
import type { PlanStepState } from '@oh-my-harness/shared'

export interface PlanStep {
  /** Stable across plan revisions. */
  id: string
  text: string
  state: PlanStepState
  /** Why the step was skipped, failed, or what it produced. */
  note?: string
  /** Whether the agent added this step after the original plan. */
  added?: boolean
}

export interface AgentPlanProps {
  className?: string
  steps: readonly PlanStep[]
}
