import { EmptyState } from '@agile-avocation/ui-pro/empty-state'
import { Magnifier } from '@gravity-ui/icons'
import { memo, useEffect, useMemo, useRef } from 'react'
import {
  type AgentTraceRecord,
  AgentTraceRecordKind,
} from '../types/agent-trace'
import { TraceEventRow } from './TraceEventRow'

interface TraceEventListItem {
  isRunStart: boolean
  isTurnStart: boolean
  record: AgentTraceRecord
}

function toTraceEventListItems(
  records: readonly AgentTraceRecord[],
): TraceEventListItem[] {
  let previousRun: string | undefined
  return records.map((record, index) => {
    const previous = records[index - 1]
    const hasTurn = record.turn > 0

    const isRunStart =
      record.kind !== AgentTraceRecordKind.SYSTEM &&
      record.runId !== undefined &&
      record.runId !== previousRun
    if (record.kind !== AgentTraceRecordKind.SYSTEM) previousRun = record.runId
    return {
      isRunStart,
      isTurnStart:
        hasTurn &&
        (record.turn !== previous?.turn ||
          record.runId !== previous?.runId ||
          (previous?.kind === AgentTraceRecordKind.REQUEST &&
            (records[index - 2]?.turn !== record.turn ||
              records[index - 2]?.runId !== record.runId))),
      record,
    }
  })
}

interface TraceEventListProps {
  rangeRecordIds: ReadonlySet<string> | null
  records: readonly AgentTraceRecord[]
  selectedRecordId: string | null
  onSelect: (record: AgentTraceRecord) => void
}

export const TraceEventList = memo(function TraceEventList({
  rangeRecordIds,
  records,
  selectedRecordId,
  onSelect,
}: TraceEventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => toTraceEventListItems(records), [records])
  const selectedIndex = useMemo(
    () => items.findIndex((item) => item.record.id === selectedRecordId),
    [items, selectedRecordId],
  )
  const selectedTurn =
    selectedIndex >= 0 ? (items[selectedIndex]?.record.turn ?? null) : null
  const selectedRun =
    selectedIndex >= 0 ? items[selectedIndex]?.record.runId : undefined

  useEffect(() => {
    if (selectedIndex < 0) return

    const selectedRow = parentRef.current?.querySelector<HTMLElement>(
      '[data-current=true]',
    )
    const parent = parentRef.current
    if (!selectedRow || !parent) return
    const rowBounds = selectedRow.getBoundingClientRect()
    const bounds = parent.getBoundingClientRect()
    if (rowBounds.top < bounds.top)
      parent.scrollTop += rowBounds.top - bounds.top
    else if (rowBounds.bottom > bounds.bottom)
      parent.scrollTop += rowBounds.bottom - bounds.bottom
  }, [selectedIndex])

  if (records.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-background">
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Magnifier className="size-5" />
            </EmptyState.Media>
            <EmptyState.Title>未找到轨迹记录</EmptyState.Title>
            <EmptyState.Description>
              尝试调整搜索词、类型、状态或工具筛选
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </div>
    )
  }

  return (
    <div
      className="h-full min-h-0 overflow-x-hidden overflow-y-auto bg-background pb-12"
      ref={parentRef}
    >
      <ul aria-label="轨迹事件" className="m-0 w-full list-none p-0">
        {items.map((item, index) => {
          const { record, isTurnStart, isRunStart } = item
          const nextRecord = items[index + 1]?.record
          const hasFollowingOutput =
            nextRecord?.runId === record.runId &&
            nextRecord?.turn === record.turn &&
            nextRecord?.request === record.request &&
            (nextRecord?.kind === AgentTraceRecordKind.ASSISTANT ||
              nextRecord?.kind === AgentTraceRecordKind.TOOL)

          return (
            <li key={record.id}>
              {isRunStart ? (
                <div
                  className="border-b border-separator bg-default/40 px-1 py-1 text-[10px] text-muted"
                  title={record.runId}
                >
                  Run {record.runNumber}
                </div>
              ) : null}
              <TraceEventRow
                hasFollowingOutput={hasFollowingOutput}
                isTurnSelected={
                  record.turn === selectedTurn && record.runId === selectedRun
                }
                isTurnStart={isTurnStart}
                rangeRecordIds={rangeRecordIds}
                record={record}
                selectedRecordId={selectedRecordId}
                onSelect={onSelect}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
})
