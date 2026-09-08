import { Button, Tooltip } from '@heroui/react'
import { AGENT_TRAJECTORY_RECORD_KIND } from '@oh-my-harness/shared'
import { type AgentTraceRecord } from '../types/agent-trace.ts'
import { getTraceEventRowText } from '../utils/get-trace-event-row-text.ts'
import { TraceKindChip } from './TraceKindChip.tsx'

const ROW_CLASS_NAME =
  'flex! h-[30px]! min-h-[30px]! transform-none! items-stretch! justify-start rounded-none! border-b border-separator/70 px-0 py-0 text-left'
const SELECTED_CLASS_NAME =
  '[--button-bg:var(--default)] [--button-bg-hover:var(--default)] [--button-bg-pressed:var(--default)]'

interface TraceEventRowProps {
  hasFollowingOutput: boolean
  isTurnSelected: boolean
  isTurnStart: boolean
  rangeRecordIds: ReadonlySet<string> | null
  record: AgentTraceRecord
  selectedRecordId: string | null
  onSelect: (record: AgentTraceRecord) => void
}

/** 展示一条轨迹事件及其轮次标记。 */
export function TraceEventRow({
  hasFollowingOutput,
  isTurnSelected,
  isTurnStart,
  rangeRecordIds,
  record,
  selectedRecordId,
  onSelect,
}: TraceEventRowProps) {
  const isInRange = rangeRecordIds === null || rangeRecordIds.has(record.id)
  const isSelected = record.id === selectedRecordId
  const isRequest = record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST

  if (isRequest) {
    return (
      <div
        className={`pointer-events-none relative z-30 ${hasFollowingOutput ? 'h-0' : 'h-6'} ${isInRange ? 'opacity-100' : 'opacity-20'}`}
      >
        <Tooltip delay={0}>
          <Button
            isIconOnly
            aria-label={`查看请求：${record.label}`}
            aria-pressed={isSelected}
            className={`pointer-events-auto absolute left-2 size-6! min-h-6! min-w-6! transform-none! rounded-sm bg-transparent! p-0 ${hasFollowingOutput ? '-top-3' : 'top-0'}`}
            data-current={isSelected || undefined}
            size="sm"
            variant="ghost"
            onPress={() => onSelect(record)}
          >
            <span
              aria-hidden
              className="size-[5px] shrink-0 rounded-full bg-foreground"
            />
          </Button>
          <Tooltip.Content
            className="rounded-sm border border-separator px-1 py-0.5 text-[9px] leading-3"
            placement="right"
          >
            {record.label}
          </Tooltip.Content>
        </Tooltip>
        {!hasFollowingOutput && (
          <span className="absolute top-1 left-10 text-[10px] text-muted">
            Turn {record.turn}
          </span>
        )}
      </div>
    )
  }

  return (
    <Button
      fullWidth
      aria-label={`查看轨迹记录：${record.label}`}
      aria-pressed={isSelected}
      className={`${ROW_CLASS_NAME} ${isSelected ? SELECTED_CLASS_NAME : ''} ${isInRange ? 'opacity-100' : 'opacity-20'}`}
      data-current={isSelected || undefined}
      size="sm"
      variant="ghost"
      onPress={() => onSelect(record)}
    >
      <span className="flex h-full min-w-0 w-full items-stretch">
        <span className="relative w-10 shrink-0 self-stretch">
          {record.turn > 0 && isTurnStart ? (
            <span
              className={`absolute top-1/2 left-0 z-20 -translate-y-1/2 rounded-sm px-1 py-0.5 text-[9px] leading-none font-medium tabular-nums ${
                isTurnSelected
                  ? 'bg-accent/12 text-accent'
                  : 'bg-default text-foreground'
              }`}
            >
              Turn {record.turn}
            </span>
          ) : null}
          {isSelected ? (
            <span className="absolute inset-y-0 left-0 z-10 w-[3px] bg-accent" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 pr-3">
          <span className="flex w-20 shrink-0 justify-end">
            <TraceKindChip kind={record.kind} />
          </span>
          <span
            className={`min-w-0 truncate text-xs ${isSelected || (rangeRecordIds !== null && isInRange) ? 'text-foreground' : 'text-muted'}`}
          >
            {getTraceEventRowText(record)}
          </span>
        </span>
      </span>
    </Button>
  )
}
