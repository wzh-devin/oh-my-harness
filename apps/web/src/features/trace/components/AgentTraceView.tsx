import { Button } from '@heroui/react'
import {
  AGENT_TRAJECTORY_RECORD_KIND,
  AGENT_TRAJECTORY_STATUS,
} from '@oh-my-harness/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyTraceUpdate,
  getAgentTrace,
  getAgentTraceRecord,
  subscribeTraceUpdates,
  type AgentTraceUpdate,
} from '../api/index.ts'
import type {
  AgentTraceRange,
  AgentTraceFilters,
  AgentTraceRecord,
  AgentTraceRecordDetail,
  AgentTraceSession,
} from '../types/agent-trace.ts'
import { filterTraceRecords } from '../utils/filter-trace-records.ts'
import { useTraceSearch } from '../hooks/use-trace-search.ts'
import {
  getTraceTimelineSlots,
  getTraceRangeRecordIds,
  getTraceRangeAfterNavigation,
} from '../utils/trace-timeline.ts'
import { TraceDetailPanel } from './TraceDetailPanel.tsx'
import { TraceEventList } from './TraceEventList.tsx'
import { TraceTimeline } from './TraceTimeline.tsx'
import { TraceToolbar } from './TraceToolbar.tsx'

interface AgentTraceViewProps {
  revision: number
  sessionId: string
}

export function AgentTraceView({ revision, sessionId }: AgentTraceViewProps) {
  const [range, setRange] = useState<AgentTraceRange | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<AgentTraceFilters>({
    kinds: [],
    statuses: [],
    toolNames: [],
  })
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [trace, setTrace] = useState<AgentTraceSession | null>(null)
  const [detail, setDetail] = useState<AgentTraceRecordDetail | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(Date.now)
  const running =
    trace?.runs.some((run) => run.status === AGENT_TRAJECTORY_STATUS.RUNNING) ??
    false
  const durationMs =
    trace && running
      ? Math.max(trace.durationMs, now - trace.startedAt)
      : (trace?.durationMs ?? 0)
  const query = search.trim().toLowerCase()
  const searchResult = useTraceSearch(
    sessionId,
    query,
    trace?.cursor.sequence ?? 0,
    retry,
  )
  const selectedStartMs = trace?.records.find(
    (record) => record.id === selectedRecordId,
  )?.startMs
  const selected = trace?.records.find(
    (record) => record.id === selectedRecordId,
  )
  const inlineDetail =
    selected?.preview !== undefined &&
    selected.source !== undefined &&
    selected.detail !== undefined
      ? {
          ...selected,
          detail: selected.detail,
          preview: selected.preview,
          source: selected.source,
          raw: selected.raw ?? {},
        }
      : undefined
  const hasInlineDetail = Boolean(inlineDetail)
  const selectedStatus = selected?.status

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    let current = true
    let loaded = false
    const pending: AgentTraceUpdate[] = []
    const unsubscribe = subscribeTraceUpdates(sessionId, (event) => {
      if (!loaded) pending.push(event)
      else setTrace((value) => (value ? applyTraceUpdate(value, event) : value))
    })
    void getAgentTrace(sessionId)
      .then((next) => {
        if (!current) return
        setTrace(pending.reduce(applyTraceUpdate, next))
        loaded = true
        setError('')
      })
      .catch((cause: unknown) => {
        loaded = true
        pending.length = 0
        if (current)
          setError(cause instanceof Error ? cause.message : '轨迹读取失败。')
      })
    return () => {
      current = false
      unsubscribe()
    }
  }, [revision, sessionId, retry])

  useEffect(() => {
    if (selectedStartMs === undefined || !selectedRecordId || hasInlineDetail)
      return
    let current = true
    void getAgentTraceRecord(sessionId, selectedRecordId, selectedStartMs)
      .then((record) => {
        if (current) {
          setDetail(record)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : '轨迹详情读取失败。',
          )
      })
    return () => {
      current = false
    }
  }, [
    selectedRecordId,
    selectedStartMs,
    selectedStatus,
    sessionId,
    hasInlineDetail,
    retry,
  ])

  const allRecords = useMemo(() => {
    return (trace?.records ?? []).map((record) =>
      record.status === AGENT_TRAJECTORY_STATUS.RUNNING && trace
        ? {
            ...record,
            durationMs: Math.max(
              record.durationMs,
              now - trace.startedAt - record.startMs,
            ),
          }
        : record,
    )
  }, [trace, now])
  const records = useMemo(
    () => filterTraceRecords(allRecords, filters, searchResult.recordIds),
    [allRecords, filters, searchResult.recordIds],
  )
  const hasFilters = Boolean(
    query ||
    filters.kinds.length ||
    filters.statuses.length ||
    filters.toolNames.length,
  )
  const toolNames = useMemo(
    () =>
      [
        ...new Set(
          allRecords
            .filter(
              (record) => record.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL,
            )
            .map((record) => record.label),
        ),
      ].sort(),
    [allRecords],
  )
  const matchingRecordIds = useMemo(
    () => (hasFilters ? new Set(records.map((record) => record.id)) : null),
    [hasFilters, records],
  )
  const selectedRecord = selected ?? null
  const selectedDetail = inlineDetail ?? detail
  const slots = useMemo(() => getTraceTimelineSlots(allRecords), [allRecords])
  const rangeRecordIds = useMemo(
    () => getTraceRangeRecordIds(slots, range),
    [slots, range],
  )
  const visibleRecordCount = records.filter(
    (record) => rangeRecordIds === null || rangeRecordIds.has(record.id),
  ).length
  /** 清除内容条件但保留独立手动选区。 */
  const clearFilters = useCallback(() => {
    setSearch('')
    setFilters({ kinds: [], statuses: [], toolNames: [] })
  }, [])
  /** 范围内切换详情保留选区，范围外导航恢复全部记录。 */
  const handleRecordNavigate = useCallback(
    (id: string) => {
      if (matchingRecordIds !== null && !matchingRecordIds.has(id))
        clearFilters()
      setRange((current) =>
        getTraceRangeAfterNavigation(current, rangeRecordIds, id),
      )
      setSelectedRecordId(id)
    },
    [rangeRecordIds, matchingRecordIds, clearFilters],
  )
  const handleRecordSelect = (record: AgentTraceRecord) =>
    handleRecordNavigate(record.id)

  if (!trace) {
    return (
      <div className="grid h-full place-items-center bg-background text-sm text-muted">
        <div className="flex items-center gap-2">
          {error || '正在加载轨迹…'}
          {error ? (
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => setRetry((value) => value + 1)}
            >
              重试
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0">
        <TraceToolbar
          durationMs={durationMs}
          runCount={trace.runs.length}
          turnCount={trace.turnCount}
          requestCount={trace.requestCount}
          model={trace.model}
          countLabel={
            searchResult.pending
              ? '搜索中…'
              : range
                ? `范围内 ${visibleRecordCount}/${records.length}`
                : hasFilters
                  ? `匹配 ${records.length} / ${allRecords.length}`
                  : `${allRecords.length} 条`
          }
          filters={filters}
          toolNames={toolNames}
          search={search}
          onFiltersChange={setFilters}
          onSearchChange={setSearch}
          onClear={clearFilters}
        />
        {searchResult.error && (
          <div
            role="alert"
            className="flex items-center gap-2 px-3 py-1 text-xs text-danger"
          >
            {searchResult.error}
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => setRetry((value) => value + 1)}
            >
              重试搜索
            </Button>
          </div>
        )}
        {error ? (
          <p className="border-b border-separator py-1 text-xs text-danger">
            {error}
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => setRetry((value) => value + 1)}
            >
              重试
            </Button>
          </p>
        ) : null}
        <TraceTimeline
          range={range}
          slots={slots}
          matchingRecordIds={matchingRecordIds}
          selectedRecordId={selectedRecordId}
          onRangeChange={setRange}
          onSelectRecord={handleRecordSelect}
        />
      </div>

      <div className="flex min-h-0 flex-1 lg:flex-row">
        <div
          className={`min-h-0 min-w-0 flex-1 overflow-hidden ${selectedRecord ? 'hidden lg:block' : 'block'}`}
        >
          {query &&
          !records.length &&
          (searchResult.pending || searchResult.error) ? (
            <div
              role="status"
              className="grid h-full place-items-center text-xs text-muted"
            >
              {searchResult.error
                ? '搜索未完成，请重试或清除筛选。'
                : '正在搜索轨迹全文…'}
            </div>
          ) : (
            <TraceEventList
              rangeRecordIds={rangeRecordIds}
              records={records}
              selectedRecordId={selectedRecordId}
              onSelect={handleRecordSelect}
            />
          )}
        </div>

        {selectedRecord ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-separator lg:w-[clamp(320px,38%,720px)] lg:max-w-[calc(100%-280px)] lg:flex-none lg:border-l">
            {selectedDetail?.id === selectedRecord.id ? (
              <TraceDetailPanel
                key={selectedDetail.id}
                record={selectedDetail}
                startedAt={trace.startedAt}
                onNavigate={handleRecordNavigate}
                onClose={() => setSelectedRecordId(null)}
              />
            ) : (
              <div className="grid h-full place-items-center text-xs text-muted">
                正在加载详情…
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
