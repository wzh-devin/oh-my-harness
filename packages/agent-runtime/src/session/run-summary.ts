import {
  RUN_RECOVERY_ACTION,
  RUN_STATUS,
  type RunRecoveryAction,
  type RunStatus,
} from '@oh-my-harness/shared'

import type { TokenUsage } from '../execution/token-usage.ts'

export { RUN_RECOVERY_ACTION, RUN_STATUS }
export type { RunRecoveryAction, RunStatus }

/** 不含消息全文的可重建 Run 查询摘要。 */
export interface AgentRunSummary {
  completedAt?: number
  cost: TokenUsage['cost']
  errorCode?: string
  errorMessage?: string
  lastAssistantMessageId?: string
  modelId: string
  permission?: string
  providerId: string
  recoveryAction?: RunRecoveryAction
  runId: string
  sessionId: string
  startedAt: number
  status: RunStatus
  tokenUsage: TokenUsage
  updatedAt: number
}

export interface AgentRunPage {
  items: AgentRunSummary[]
  nextCursor: string | null
}

/** JSONL 到 SQLite Run 摘要的最小投影能力。 */
export interface AgentRunProjection {
  getCostSince(timestamp: number): Promise<number>
  getRun(runId: string): Promise<AgentRunSummary | undefined>
  listRuns(options: {
    cursor?: string
    limit: number
    status?: RunStatus
  }): Promise<AgentRunPage>
}
