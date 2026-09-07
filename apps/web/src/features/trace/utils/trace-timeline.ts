import type { AgentTraceRange, AgentTraceRecord } from '../types/agent-trace.ts'

export interface TraceTimelineSlot extends AgentTraceRange {
  record: AgentTraceRecord
  requestId?: string
  boundary?: string
}

/** 记录导航只在目标位于范围外时清除选区，Request 与输出复用同一命中集合。 */
export const getTraceRangeAfterNavigation = (
  range: AgentTraceRange | null,
  rangeRecordIds: ReadonlySet<string> | null,
  recordId: string,
): AgentTraceRange | null =>
  rangeRecordIds !== null && !rangeRecordIds.has(recordId) ? null : range

/** 将真实事件顺序投影为等宽格子；Request 与其 Assistant 共用一格，不修改真实耗时。 */
export const getTraceTimelineSlots = (
  records: readonly AgentTraceRecord[],
): TraceTimelineSlot[] => {
  const recordMap = new Map(records.map((record) => [record.id, record]))
  const requestsByResult = new Map(
    records.flatMap((record) =>
      record.kind === 'request' && record.resultRecordId
        ? [[record.resultRecordId, record] as const]
        : [],
    ),
  )
  const slots: TraceTimelineSlot[] = []
  let previousRun: string | undefined
  const turnSet = new Set<string>()
  for (const record of records) {
    if (
      record.kind === 'request' &&
      record.resultRecordId &&
      recordMap.has(record.resultRecordId)
    )
      continue
    const request = requestsByResult.get(record.id)
    const isRunStart = record.kind !== 'system' && previousRun !== record.runId
    const turnKey = `${record.runId}:${record.turn}`
    const isTurnStart = record.turn > 0 && !turnSet.has(turnKey)
    if (record.kind !== 'system') previousRun = record.runId
    if (record.turn > 0) turnSet.add(turnKey)
    slots.push({
      record,
      requestId: request?.id,
      startPosition: request?.position ?? record.position,
      endPosition: record.position,
      boundary:
        isRunStart || isTurnStart
          ? `Run ${record.runNumber}${record.turn > 0 ? ` · Turn ${record.turn}` : ''}`
          : undefined,
    })
  }
  return slots
}

/** 将连续格子坐标锚定到来源 position + 格内比例，流式输出不会改变锚点。 */
const positionAt = (
  slots: readonly TraceTimelineSlot[],
  point: number,
): number => {
  const index = Math.min(slots.length - 1, Math.floor(point))
  return point + (slots[index]!.startPosition - index)
}

/** 归一化自由选区；最小宽度由调用方按像素换算，不再按事件取整。 */
export const normalizeTraceRange = (
  slots: readonly TraceTimelineSlot[],
  start: number,
  end: number,
  minimumWidth = 0.001,
): AgentTraceRange | null => {
  if (!slots.length || !Number.isFinite(start) || !Number.isFinite(end))
    return null
  const minimum = Math.min(slots.length, Math.max(0.001, minimumWidth))
  const clamp = (point: number) => Math.max(0, Math.min(slots.length, point))
  let left = clamp(Math.min(start, end))
  let right = clamp(Math.max(start, end))
  if (right - left < minimum) {
    left = Math.max(
      0,
      Math.min(slots.length - minimum, (left + right - minimum) / 2),
    )
    right = left + minimum
  }
  return {
    startPosition: positionAt(slots, left),
    endPosition: positionAt(slots, right),
  }
}

/** 将稳定来源锚点还原为连续格子坐标，兼容当前请求输出到达这一正常生命周期。 */
export const getTraceRangeIndexes = (
  slots: readonly TraceTimelineSlot[],
  range: AgentTraceRange | null,
): { start: number; end: number } | null => {
  if (!range || !slots.length) return null
  const pointAt = (position: number) => {
    for (let index = 0; index < slots.length; index++) {
      const start = slots[index]!.startPosition
      if (position <= start + 1)
        return Math.max(index, position + (index - start))
    }
    return slots.length
  }
  const start = pointAt(range.startPosition)
  const end = pointAt(range.endPosition)
  return end > start ? { start, end } : null
}

/** 单侧连续调整，另一端不动；最小像素宽度和轨道边界防止交叉。 */
export const resizeTraceRange = (
  slots: readonly TraceTimelineSlot[],
  range: AgentTraceRange,
  edge: 'start' | 'end',
  point: number,
  minimumWidth = 0.001,
): AgentTraceRange | null => {
  const indexes = getTraceRangeIndexes(slots, range)
  if (!indexes) return null
  const minimum = Math.min(minimumWidth, indexes.end - indexes.start)
  return normalizeTraceRange(
    slots,
    edge === 'start'
      ? Math.max(0, Math.min(point, indexes.end - minimum))
      : indexes.start,
    edge === 'end'
      ? Math.min(slots.length, Math.max(point, indexes.start + minimum))
      : indexes.end,
    minimum,
  )
}

/** 部分相交即命中完整记录，Request 后到的输出也属于已选格子。 */
export const getTraceRangeRecordIds = (
  slots: readonly TraceTimelineSlot[],
  range: AgentTraceRange | null,
): ReadonlySet<string> | null => {
  if (!range) return null
  const indexes = getTraceRangeIndexes(slots, range)
  if (!indexes) return new Set()
  return new Set(
    slots
      .slice(Math.floor(indexes.start), Math.ceil(indexes.end))
      .flatMap((slot) =>
        slot.requestId ? [slot.requestId, slot.record.id] : [slot.record.id],
      ),
  )
}
