export const AgentTraceLane = {
  INPUT: 'input',
  MODEL: 'model',
  TOOLS: 'tools',
} as const

export type AgentTraceLane =
  (typeof AgentTraceLane)[keyof typeof AgentTraceLane]

export const AgentTraceRecordKind = {
  ASSISTANT: 'assistant',
  CONTEXT: 'context',
  REQUEST: 'request',
  SYSTEM: 'system',
  TOOL: 'tool',
  USER: 'user',
} as const

export type AgentTraceRecordKind =
  (typeof AgentTraceRecordKind)[keyof typeof AgentTraceRecordKind]

export const AgentTraceStatus = {
  ABORTED: 'aborted',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  RUNNING: 'running',
} as const

export type AgentTraceStatus =
  (typeof AgentTraceStatus)[keyof typeof AgentTraceStatus]

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
    | { kind: 'system' | 'context' | 'user'; lane: 'input' }
    | {
        kind: 'request' | 'assistant'
        lane: 'model'
        request: number
        sourceRecordId: string
      }
    | { kind: 'tool'; lane: 'tools'; request: number; sourceRecordId: string }
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
