import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Tooltip } from '@heroui/react'
import {
  AGENT_TRACE_KIND_LABELS,
  AGENT_TRACE_KIND_STYLES,
} from '../constants/agent-trace.ts'
import type { AgentTraceRecord } from '../types/agent-trace.ts'
import { formatTraceDuration } from '../utils/format-trace-duration.ts'

const TRACE_RECORD_TOOLTIP_DELAY_MS = 1_000

interface TraceTimelineRecordProps {
  index: number
  slotCount: number
  isDimmed: boolean
  isSelected: boolean
  record: AgentTraceRecord
  onSelect: (record: AgentTraceRecord) => void
}

/** 展示时间轴中的一条可选择轨迹记录。 */
export function TraceTimelineRecord({
  index,
  slotCount,
  isDimmed,
  isSelected,
  record,
  onSelect,
}: TraceTimelineRecordProps) {
  const endMs = record.startMs + record.durationMs
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    onSelect(record)
  }

  return (
    <Tooltip delay={TRACE_RECORD_TOOLTIP_DELAY_MS}>
      <Tooltip.Trigger
        aria-current={isSelected || undefined}
        aria-label={`${record.label}，${formatTraceDuration(record.startMs)} 到 ${formatTraceDuration(endMs)}`}
        className="group absolute inset-y-0 cursor-[var(--cursor-interactive)] outline-none"
        data-trace-timeline-record={record.id}
        data-trace-kind={record.kind}
        role="button"
        style={{
          left: `${(index / slotCount) * 100}%`,
          width: `${100 / slotCount}%`,
        }}
        tabIndex={0}
        onClick={() => onSelect(record)}
        onKeyDown={handleKeyDown}
      >
        <span
          aria-hidden
          className={`absolute inset-x-px inset-y-2 rounded-[1px] ${AGENT_TRACE_KIND_STYLES[record.kind].timelineClassName} ${isDimmed ? 'opacity-20' : ''}`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 inset-y-[6px] rounded-[3px] border border-accent ${
            isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          }`}
        />
      </Tooltip.Trigger>
      <Tooltip.Content
        className="flex flex-col gap-0.5 whitespace-nowrap"
        placement="bottom"
      >
        <span className="font-semibold">
          {AGENT_TRACE_KIND_LABELS[record.kind]}
        </span>
        <span>{record.label}</span>
        <span className="tabular-nums text-muted">
          {formatTraceDuration(record.startMs)} → {formatTraceDuration(endMs)} ·
          总计 {formatTraceDuration(record.durationMs)}
        </span>
      </Tooltip.Content>
    </Tooltip>
  )
}
