import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useRef } from 'react'
import { AGENT_TRAJECTORY_LANE } from '@oh-my-harness/shared'
import { AGENT_TRACE_LANE_LABELS } from '../constants/agent-trace'
import {
  type AgentTraceRange,
  type AgentTraceRecord,
} from '../types/agent-trace'
import {
  getTraceRangeIndexes,
  normalizeTraceRange,
  resizeTraceRange,
  type TraceTimelineSlot,
} from '../utils/trace-timeline'
import { TraceTimelineRecord } from './TraceTimelineRecord'

const TIMELINE_LANES = [
  AGENT_TRAJECTORY_LANE.INPUT,
  AGENT_TRAJECTORY_LANE.MODEL,
  AGENT_TRAJECTORY_LANE.TOOLS,
] as const

interface TraceTimelineProps {
  range: AgentTraceRange | null
  slots: readonly TraceTimelineSlot[]
  matchingRecordIds: ReadonlySet<string> | null
  selectedRecordId: string | null
  onRangeChange: (range: AgentTraceRange | null) => void
  onSelectRecord: (record: AgentTraceRecord) => void
}

interface RangeGesture {
  pointerId: number
  edge: 'start' | 'end' | 'create'
  anchorRange: AgentTraceRange | null
  anchorClientX: number
  moved: boolean
  initialRange: AgentTraceRange | null
}

/** 使用事件序列绘制三泳道概览，范围状态与列表共用 position，真实时间只用于详情。 */
export const TraceTimeline = memo(function TraceTimeline({
  range,
  slots,
  matchingRecordIds,
  selectedRecordId,
  onRangeChange,
  onSelectRecord,
}: TraceTimelineProps) {
  const indexes = getTraceRangeIndexes(slots, range)
  const gestureRef = useRef<RangeGesture | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  /** 用轨道宽度转换连续坐标，不取整、不吸附事件边界。 */
  const resolveIndex = (clientX: number): number => {
    const bounds = timelineRef.current!.getBoundingClientRect()
    return Math.max(
      0,
      Math.min(
        slots.length,
        ((clientX - bounds.left) / Math.max(1, bounds.width)) * slots.length,
      ),
    )
  }

  const pixelWidth = (pixels: number) =>
    (pixels /
      Math.max(1, timelineRef.current?.getBoundingClientRect().width ?? 1)) *
    slots.length

  /** 开始新选区或调整单端；记录点击仍独立打开详情。 */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !slots.length || gestureRef.current) return
    const target = event.target instanceof Element ? event.target : null
    const edge = target
      ?.closest('[data-trace-range-edge]')
      ?.getAttribute('data-trace-range-edge')
    if (
      edge !== 'start' &&
      edge !== 'end' &&
      target?.closest('[data-trace-timeline-record]')
    )
      return
    const index = resolveIndex(event.clientX)
    gestureRef.current = {
      pointerId: event.pointerId,
      edge: edge === 'start' || edge === 'end' ? edge : 'create',
      anchorRange: normalizeTraceRange(slots, index, index, 0.001),
      anchorClientX: event.clientX,
      moved: false,
      initialRange: range,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (edge !== 'start' && edge !== 'end') {
      event.currentTarget.focus()
      onRangeChange(normalizeTraceRange(slots, index, index, pixelWidth(48)))
    }
  }

  /** 连续移动选区边界，点击保持小选区，跨边界时同时命中相邻事件。 */
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const index = resolveIndex(event.clientX)
    if (gesture.edge === 'create') {
      gesture.moved ||= Math.abs(event.clientX - gesture.anchorClientX) >= 3
      if (!gesture.moved) return
      const anchor = getTraceRangeIndexes(slots, gesture.anchorRange)
      if (!anchor) return
      onRangeChange(
        normalizeTraceRange(
          slots,
          (anchor.start + anchor.end) / 2,
          index,
          pixelWidth(24),
        ),
      )
    } else if (gesture.initialRange) {
      const initialIndexes = getTraceRangeIndexes(slots, gesture.initialRange)
      if (!initialIndexes) return
      const width = Math.max(
        1,
        timelineRef.current!.getBoundingClientRect().width,
      )
      const delta =
        ((event.clientX - gesture.anchorClientX) / width) * slots.length
      onRangeChange(
        resizeTraceRange(
          slots,
          gesture.initialRange,
          gesture.edge,
          initialIndexes[gesture.edge] + delta,
          pixelWidth(24),
        ),
      )
    }
  }

  /** 松开提交最后位置并释放捕获；意外取消时恢复拖动前的范围。 */
  const handlePointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (cancelled) onRangeChange(gesture.initialRange)
    else handlePointerMove(event)
    gestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  /** 键盘可建立选区或调整手柄，Escape 清除；不吞掉记录自身的 Enter/Space。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      const gesture = gestureRef.current
      gestureRef.current = null
      if (gesture && event.currentTarget.hasPointerCapture(gesture.pointerId))
        event.currentTarget.releasePointerCapture(gesture.pointerId)
      onRangeChange(null)
      event.currentTarget.focus()
      return
    }
    const edge =
      event.target instanceof Element
        ? event.target.getAttribute('data-trace-range-edge')
        : null
    if ((edge === 'start' || edge === 'end') && indexes && range) {
      const current = indexes[edge]
      const step = pixelWidth(event.shiftKey ? 20 : 4)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? slots.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? current - step
              : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? current + step
                : null
      if (next === null) return
      event.preventDefault()
      onRangeChange(resizeTraceRange(slots, range, edge, next, pixelWidth(24)))
    } else if (
      event.target === event.currentTarget &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
      onRangeChange(normalizeTraceRange(slots, 0, slots.length))
    }
  }

  return (
    <section
      aria-label="轨迹概览"
      title="按事件顺序排列；拖动空白处框选，拖动两端手柄调整；Escape 清除选区"
      className="shrink-0 border-b border-separator bg-background"
    >
      <div className="grid grid-cols-[40px_minmax(0,1fr)] pr-3">
        <div className="grid grid-rows-3 pt-4 text-right text-[10px] text-muted">
          {TIMELINE_LANES.map((lane) => (
            <span key={lane} className="flex h-6 items-center justify-end pr-2">
              {AGENT_TRACE_LANE_LABELS[lane]}
            </span>
          ))}
        </div>
        <div
          ref={timelineRef}
          aria-label={
            indexes
              ? `事件概览，已选择第 ${Math.floor(indexes.start) + 1} 至 ${Math.ceil(indexes.end)} 项`
              : '事件概览，Enter 选择全部，Escape 清除'
          }
          className="relative h-[88px] touch-none select-none cursor-crosshair outline-none focus-visible:outline-1 focus-visible:outline-accent"
          data-trace-timeline
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={(event) => handlePointerEnd(event, true)}
          onLostPointerCapture={(event) => handlePointerEnd(event, true)}
        >
          {!slots.length && (
            <span className="absolute inset-0 grid place-items-center text-xs text-muted">
              暂无轨迹事件
            </span>
          )}
          {indexes && (
            <div
              aria-hidden
              data-trace-selection
              className="pointer-events-none absolute inset-y-0 bg-accent/5"
              style={{
                left: `${(indexes.start / slots.length) * 100}%`,
                width: `${((indexes.end - indexes.start) / slots.length) * 100}%`,
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 top-4 bottom-0">
            {slots.map((slot, index) =>
              slot.boundary && index > 0 ? (
                <span
                  key={slot.record.id}
                  title={slot.boundary}
                  data-trace-boundary={slot.boundary}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-separator"
                  style={{ left: `${(index / slots.length) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <div className="absolute inset-x-0 top-4 grid grid-rows-3">
            {TIMELINE_LANES.map((lane) => (
              <div className="relative h-6" key={lane}>
                {slots.map((slot, index) =>
                  slot.record.lane === lane ? (
                    <TraceTimelineRecord
                      key={slot.requestId ?? slot.record.id}
                      index={index}
                      slotCount={slots.length}
                      isDimmed={
                        (indexes !== null &&
                          (index + 1 <= indexes.start ||
                            index >= indexes.end)) ||
                        (matchingRecordIds !== null &&
                          !matchingRecordIds.has(slot.record.id) &&
                          !(
                            slot.requestId &&
                            matchingRecordIds.has(slot.requestId)
                          ))
                      }
                      isSelected={
                        slot.record.id === selectedRecordId ||
                        slot.requestId === selectedRecordId
                      }
                      record={slot.record}
                      onSelect={onSelectRecord}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
          {indexes &&
            (['start', 'end'] as const).map((edge) => {
              const fraction = indexes[edge] / slots.length
              return (
                <button
                  key={edge}
                  type="button"
                  role="slider"
                  aria-label={edge === 'start' ? '选区起点' : '选区终点'}
                  aria-orientation="horizontal"
                  aria-valuemin={
                    edge === 'start' ? 0 : (indexes.start / slots.length) * 100
                  }
                  aria-valuemax={
                    edge === 'start' ? (indexes.end / slots.length) * 100 : 100
                  }
                  aria-valuenow={fraction * 100}
                  aria-valuetext={`概览位置 ${(fraction * 100).toFixed(1)}%`}
                  data-trace-range-edge={edge}
                  title={
                    edge === 'start'
                      ? '拖动调整起点，或使用方向键'
                      : '拖动调整终点，或使用方向键'
                  }
                  className="group absolute top-0 z-10 flex h-6 w-6 cursor-ew-resize justify-center border-0 bg-transparent p-0 outline-none"
                  style={{
                    left: `clamp(0px, calc(${fraction * 100}% - 12px), calc(100% - 24px))`,
                  }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-4 left-1/2 h-[72px] w-[3px] -translate-x-1/2 bg-accent"
                  />
                  <span
                    aria-hidden
                    className="flex h-4 w-3 items-center justify-center gap-[2px] rounded-[3px] border border-accent bg-background text-accent group-hover:bg-accent-soft group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent"
                  >
                    <span className="h-2 w-px bg-current" />
                    <span className="h-2 w-px bg-current" />
                  </span>
                </button>
              )
            })}
        </div>
      </div>
    </section>
  )
})
