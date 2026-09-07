import { Magnifier, Xmark } from '@gravity-ui/icons'
import { Popover } from '@heroui/react'
import {
  AGENT_TRACE_KIND_LABELS,
  AGENT_TRACE_STATUS_LABELS,
} from '../constants/agent-trace.ts'
import type {
  AgentTraceFilters,
  AgentTraceRecordKind,
  AgentTraceStatus,
} from '../types/agent-trace.ts'
import { formatTraceDuration } from '../utils/format-trace-duration.ts'

interface TraceFilterMenuProps<T extends string> {
  label: string
  options: readonly { id: T; label: string }[]
  selected: readonly T[]
  onChange: (selected: T[]) => void
}

/** 在同一浮层中分组多选，沿用当前维度的筛选状态。 */
function TraceFilterMenu<T extends string>({
  label,
  options,
  selected,
  onChange,
}: TraceFilterMenuProps<T>) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="mb-1 text-muted">{label}</legend>
      <div className="grid grid-cols-2 gap-x-3">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-7 min-w-0 cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id),
                )
              }
              className="size-3.5 shrink-0 accent-accent"
            />
            <span className="truncate" title={option.label}>
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {!options.length && <p className="text-muted">暂无工具调用</p>}
    </fieldset>
  )
}

const KIND_OPTIONS = (
  [
    'system',
    'user',
    'context',
    'assistant',
    'request',
    'tool',
  ] as AgentTraceRecordKind[]
).map((id) => ({ id, label: AGENT_TRACE_KIND_LABELS[id] }))
const STATUS_OPTIONS = (
  [
    'running',
    'completed',
    'failed',
    'aborted',
    'interrupted',
  ] as AgentTraceStatus[]
).map((id) => ({ id, label: AGENT_TRACE_STATUS_LABELS[id] }))

interface TraceToolbarProps {
  durationMs: number
  runCount: number
  turnCount: number
  requestCount: number
  model: string
  countLabel: string
  filters: AgentTraceFilters
  toolNames: readonly string[]
  search: string
  onFiltersChange: (filters: AgentTraceFilters) => void
  onSearchChange: (search: string) => void
  onClear: () => void
}

/** 将只读统计与筛选控件分组，统一高度并在窄屏自然换行。 */
export function TraceToolbar({
  durationMs,
  runCount,
  turnCount,
  requestCount,
  model,
  countLabel,
  filters,
  toolNames,
  search,
  onFiltersChange,
  onSearchChange,
  onClear,
}: TraceToolbarProps) {
  const activeCount =
    filters.kinds.length + filters.statuses.length + filters.toolNames.length
  return (
    <div
      aria-label="轨迹工具栏"
      className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-b border-separator px-3 py-1 font-sans text-[12px] leading-4 font-normal text-muted"
    >
      <div
        aria-label="轨迹统计"
        className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="inline-flex min-h-7 flex-wrap items-center gap-x-1 tabular-nums">
          <span>
            {formatTraceDuration(durationMs)} · {runCount} Run · {turnCount}{' '}
            Turn · {requestCount} Request ·
          </span>
          <span aria-live="polite">{countLabel}</span>
        </span>
        <span title={model} className="inline-flex h-7 max-w-40 items-center">
          <span className="truncate">{model}</span>
        </span>
      </div>
      <div
        aria-label="轨迹筛选"
        className="ml-auto flex h-7 max-w-full items-center gap-2"
      >
        <div className="relative h-7 w-[180px] min-w-0">
          <Magnifier
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted"
          />
          <input
            aria-label="搜索轨迹记录"
            type="search"
            maxLength={512}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="搜索…"
            className="block h-7 w-full min-w-0 appearance-none rounded-sm border border-separator bg-transparent py-0 pr-7 pl-7 font-sans text-[12px] leading-4 font-normal text-foreground outline-none placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => onSearchChange('')}
              className="absolute top-0 right-0 flex size-7 items-center justify-center rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Xmark aria-hidden className="size-3" />
            </button>
          )}
        </div>
        <Popover>
          <Popover.Trigger
            aria-label={activeCount ? `筛选：${activeCount} 项` : '筛选'}
            className={`inline-flex h-7 shrink-0 items-center rounded-sm px-2 font-sans text-[12px] leading-4 font-normal outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus ${activeCount ? 'text-accent' : 'text-muted'}`}
          >
            筛选{activeCount ? ` · ${activeCount}` : ''}
          </Popover.Trigger>
          <Popover.Content
            placement="bottom end"
            className="w-72 max-w-[calc(100vw-24px)]"
          >
            <Popover.Dialog
              aria-label="轨迹筛选条件"
              className="max-h-[70vh] space-y-4 overflow-y-auto p-3 font-sans text-[12px] leading-4 font-normal"
            >
              <TraceFilterMenu
                label="类型"
                options={KIND_OPTIONS}
                selected={filters.kinds}
                onChange={(kinds) => onFiltersChange({ ...filters, kinds })}
              />
              <TraceFilterMenu
                label="状态"
                options={STATUS_OPTIONS}
                selected={filters.statuses}
                onChange={(statuses) =>
                  onFiltersChange({ ...filters, statuses })
                }
              />
              <TraceFilterMenu
                label="工具"
                options={toolNames.map((id) => ({ id, label: id }))}
                selected={filters.toolNames}
                onChange={(toolNames) =>
                  onFiltersChange({ ...filters, toolNames })
                }
              />
              <button
                type="button"
                disabled={!activeCount && !search}
                onClick={onClear}
                className="h-7 rounded-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"
              >
                清除条件
              </button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>
    </div>
  )
}
