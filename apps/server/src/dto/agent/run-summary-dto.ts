import type { AgentRunSummary } from '@oh-my-harness/agent-runtime'
import type { RunRecoveryAction, RunStatus } from '@oh-my-harness/shared'

export interface AgentRunSummaryDto extends AgentRunSummary {
  sessionId: string
}

export interface AgentRunPageDto {
  items: AgentRunSummaryDto[]
  nextCursor: string | null
}

export interface RecoverAgentRunDto {
  action: RunRecoveryAction
}

export interface RecoverAgentRunResponseDto {
  action: RunRecoveryAction
  runId: string
  runRequired: true
  sessionId: string
}

export type AgentRunStatusQuery = RunStatus
