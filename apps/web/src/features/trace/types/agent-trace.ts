import {
  AGENT_TRAJECTORY_LANE,
  AGENT_TRAJECTORY_RECORD_KIND,
  type AgentTrajectoryLane,
  type AgentTrajectoryRecordKind,
  type AgentTrajectoryStatus,
} from '@oh-my-harness/shared'

export type AgentTraceLane = AgentTrajectoryLane
export type AgentTraceRecordKind = AgentTrajectoryRecordKind
export type AgentTraceStatus = AgentTrajectoryStatus

interface AgentTraceRecordBase {
  position: number
  runId: string
  runNumber: number
  sourceRecordId?: string
  resultRecordId?: string
  preview?: string
  source?: string
  raw?: Readonly<Record<string, unknown>>
  detail?: Readonly<Record<string, unknown>>
  completedAt?: number
  durationMs: number
  id: string
  kind: AgentTraceRecordKind
  label: string
  lane: AgentTraceLane
  request?: number
  startMs: number
  status: AgentTraceStatus
  summary: string
  turn: number
}

export type AgentTraceRecord = AgentTraceRecordBase &
  (
    | {
        kind:
          | typeof AGENT_TRAJECTORY_RECORD_KIND.SYSTEM
          | typeof AGENT_TRAJECTORY_RECORD_KIND.CONTEXT
          | typeof AGENT_TRAJECTORY_RECORD_KIND.USER
        lane: typeof AGENT_TRAJECTORY_LANE.INPUT
      }
    | {
        kind:
          | typeof AGENT_TRAJECTORY_RECORD_KIND.REQUEST
          | typeof AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT
        lane: typeof AGENT_TRAJECTORY_LANE.MODEL
        request: number
        sourceRecordId: string
      }
    | {
        kind: typeof AGENT_TRAJECTORY_RECORD_KIND.TOOL
        lane: typeof AGENT_TRAJECTORY_LANE.TOOLS
        request: number
        sourceRecordId: string
      }
  )

export type AgentTraceRecordDetail = AgentTraceRecord & {
  detail: Readonly<Record<string, unknown>>
  preview: string
  raw: Readonly<Record<string, unknown>>
  source: string
}

export interface AgentTraceSession {
  completedAt?: number
  durationMs: number
  model: string
  records: readonly AgentTraceRecord[]
  requestCount: number
  sessionId: string
  cursor: { sequence: number; revision: number }
  runs: {
    runId: string
    number: number
    startedAt: number
    completedAt?: number
    status: AgentTraceStatus
  }[]
  startedAt: number
  turnCount: number
}

export interface AgentTraceRange {
  endPosition: number
  startPosition: number
}

export interface AgentTraceFilters {
  kinds: AgentTraceRecordKind[]
  statuses: AgentTraceStatus[]
  toolNames: string[]
}
