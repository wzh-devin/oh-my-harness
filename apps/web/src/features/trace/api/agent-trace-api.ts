import type {
  AgentTraceRecord,
  AgentTraceRecordDetail,
  AgentTraceSession,
} from '../types/agent-trace.ts'
import {
  AGENT_RUN_EVENT_TYPE,
  AGENT_TRAJECTORY_LANE,
  AGENT_TRAJECTORY_RECORD_KIND,
  AGENT_TRAJECTORY_STATUS,
  TRAJECTORY_STREAM_BLOCK,
  type TrajectoryStreamBlock,
} from '@oh-my-harness/shared'

interface TrajectoryRecordResponse extends Omit<AgentTraceRecord, 'startMs'> {
  startedAt: number
}
interface TrajectoryResponse extends Omit<AgentTraceSession, 'records'> {
  records: TrajectoryRecordResponse[]
}
export type AgentTraceUpdate =
  | {
      type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED
      trajectory: Omit<TrajectoryResponse, 'records'>
      records: TrajectoryRecordResponse[]
    }
  | {
      type: typeof AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA
      cursor: AgentTraceSession['cursor']
      id: string
      block: TrajectoryStreamBlock
      delta: string
    }

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
const isCount = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
const trajectoryStatuses = new Set<string>(
  Object.values(AGENT_TRAJECTORY_STATUS),
)
const trajectoryKinds = new Set<string>(
  Object.values(AGENT_TRAJECTORY_RECORD_KIND),
)
const trajectoryLanes = new Set<string>(Object.values(AGENT_TRAJECTORY_LANE))
const modelTrajectoryKinds = new Set<string>([
  AGENT_TRAJECTORY_RECORD_KIND.REQUEST,
  AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT,
  AGENT_TRAJECTORY_RECORD_KIND.TOOL,
])
const isStatus = (value: unknown) => trajectoryStatuses.has(String(value))
const isCursor = (value: unknown) =>
  isObject(value) && isCount(value.sequence) && isCount(value.revision)

function parseRecord(value: unknown): TrajectoryRecordResponse | undefined {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.summary !== 'string' ||
    !isNumber(value.startedAt) ||
    !isNumber(value.durationMs) ||
    !isCount(value.turn) ||
    !trajectoryKinds.has(String(value.kind)) ||
    !trajectoryLanes.has(String(value.lane)) ||
    !isStatus(value.status) ||
    (value.completedAt !== undefined && !isNumber(value.completedAt)) ||
    !isCount(value.position) ||
    !isCount(value.runNumber) ||
    Number(value.runNumber) < 1 ||
    typeof value.runId !== 'string' ||
    !value.runId ||
    (modelTrajectoryKinds.has(String(value.kind))
      ? !isCount(value.request) ||
        Number(value.request) < 1 ||
        Number(value.turn) < 1 ||
        typeof value.sourceRecordId !== 'string' ||
        !value.sourceRecordId ||
        value.lane !==
          (value.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL
            ? AGENT_TRAJECTORY_LANE.TOOLS
            : AGENT_TRAJECTORY_LANE.MODEL)
      : value.lane !== AGENT_TRAJECTORY_LANE.INPUT ||
        value.request !== undefined ||
        (value.kind === AGENT_TRAJECTORY_RECORD_KIND.USER &&
          value.turn !== 0)) ||
    ['runId', 'sourceRecordId', 'resultRecordId', 'preview', 'source'].some(
      (key) => value[key] !== undefined && typeof value[key] !== 'string',
    ) ||
    ['raw', 'detail'].some(
      (key) => value[key] !== undefined && !isObject(value[key]),
    )
  )
    return undefined
  return value as unknown as TrajectoryRecordResponse
}

function isMetadata(
  value: unknown,
): value is Omit<TrajectoryResponse, 'records'> {
  return (
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.model === 'string' &&
    isCursor(value.cursor) &&
    isNumber(value.startedAt) &&
    isNumber(value.durationMs) &&
    isCount(value.turnCount) &&
    isCount(value.requestCount) &&
    (value.completedAt === undefined || isNumber(value.completedAt)) &&
    Array.isArray(value.runs) &&
    value.runs.every(
      (run) =>
        isObject(run) &&
        typeof run.runId === 'string' &&
        isCount(run.number) &&
        isNumber(run.startedAt) &&
        (run.completedAt === undefined || isNumber(run.completedAt)) &&
        isStatus(run.status),
    )
  )
}

export function parseTraceUpdate(value: unknown): AgentTraceUpdate {
  if (isObject(value)) {
    if (
      value.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED &&
      isMetadata(value.trajectory) &&
      Array.isArray(value.records) &&
      value.records.every(parseRecord)
    )
      return value as unknown as AgentTraceUpdate
    if (
      value.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA &&
      isCursor(value.cursor) &&
      typeof value.id === 'string' &&
      typeof value.delta === 'string' &&
      (value.block === TRAJECTORY_STREAM_BLOCK.TEXT ||
        value.block === TRAJECTORY_STREAM_BLOCK.THINKING)
    )
      return value as unknown as AgentTraceUpdate
  }
  throw new Error('轨迹增量响应无效。')
}

async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('轨迹读取失败，请重试。')
  return response.json()
}

/** 全文匹配交给已有服务端投影，支持取消过期查询。 */
export const searchAgentTrace = async (
  sessionId: string,
  query: string,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> => {
  const value = await request(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/trajectory/search?${new URLSearchParams({ q: query })}`,
    signal,
  )
  if (
    !isObject(value) ||
    !isCursor(value.cursor) ||
    !Array.isArray(value.recordIds) ||
    !value.recordIds.every((id) => typeof id === 'string')
  )
    throw new Error('轨迹搜索响应无效。')
  return new Set(value.recordIds as string[])
}

const toRecord = (
  record: TrajectoryRecordResponse,
  startedAt: number,
): AgentTraceRecord => {
  const { startedAt: recordStartedAt, ...rest } = record
  return {
    ...rest,
    startMs: Math.max(0, recordStartedAt - startedAt),
  } as AgentTraceRecord
}

export const isLaterCursor = (
  next: AgentTraceSession['cursor'],
  previous: AgentTraceSession['cursor'],
) =>
  next.sequence > previous.sequence ||
  (next.sequence === previous.sequence && next.revision > previous.revision)

export function applyTraceUpdate(
  trace: AgentTraceSession,
  event: AgentTraceUpdate,
): AgentTraceSession {
  const cursor =
    event.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED
      ? event.trajectory.cursor
      : event.cursor
  if (!isLaterCursor(cursor, trace.cursor)) return trace
  if (event.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED) {
    if (event.trajectory.sessionId !== trace.sessionId) return trace
    const updates = new Map(
      event.records.map((record) => [
        record.id,
        toRecord(record, event.trajectory.startedAt),
      ]),
    )
    const records = trace.records.map((record) => {
      const update = updates.get(record.id)
      updates.delete(record.id)
      return update ?? record
    })
    return {
      ...event.trajectory,
      records: [...records, ...updates.values()].sort(
        (a, b) => a.position - b.position,
      ),
    }
  }
  return {
    ...trace,
    cursor,
    records: trace.records.map((record) => {
      if (record.id !== event.id) return record
      const content = String(record.detail?.[event.block] ?? '') + event.delta
      return {
        ...record,
        detail: { ...record.detail, [event.block]: content },
        ...(event.block === TRAJECTORY_STREAM_BLOCK.TEXT
          ? {
              preview: content,
              summary: content.replace(/\s+/gu, ' ').slice(0, 320),
            }
          : {}),
      }
    }),
  }
}

export async function getAgentTrace(
  sessionId: string,
): Promise<AgentTraceSession> {
  const value = await request(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/trajectory`,
  )
  if (
    !isObject(value) ||
    !Array.isArray(value.records) ||
    !value.records.every(parseRecord) ||
    !isMetadata(value)
  )
    throw new Error('轨迹响应无效。')
  const trajectory = value as unknown as TrajectoryResponse
  return {
    ...trajectory,
    records: trajectory.records.map((record) =>
      toRecord(record, trajectory.startedAt),
    ),
  }
}

export async function getAgentTraceRecord(
  sessionId: string,
  recordId: string,
  startMs: number,
): Promise<AgentTraceRecordDetail> {
  const value = await request(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/trajectory/${encodeURIComponent(recordId)}`,
  )
  const record = parseRecord(value)
  if (
    !record ||
    typeof record.preview !== 'string' ||
    typeof record.source !== 'string' ||
    !isObject(record.raw) ||
    !isObject(record.detail)
  )
    throw new Error('轨迹详情响应无效。')
  return {
    ...record,
    preview: record.preview,
    source: record.source,
    raw: record.raw,
    detail: record.detail,
    startMs,
  } as AgentTraceRecordDetail
}
