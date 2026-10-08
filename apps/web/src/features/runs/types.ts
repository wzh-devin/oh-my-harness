import type { RunRecoveryAction, RunStatus } from '@oh-my-harness/shared'

export interface RunSummaryVo {
  completedAt?: number
  cost: {
    cacheRead: number
    cacheWrite: number
    input: number
    output: number
    total: number
  }
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
  tokenUsage: {
    cacheRead: number
    cacheWrite: number
    input: number
    output: number
    total: number
  }
  updatedAt: number
}

export interface RunPageVo {
  items: RunSummaryVo[]
  nextCursor: string | null
}
