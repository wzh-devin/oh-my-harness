import { Popover } from '@heroui/react'
import type { ChatContextUsage } from '../../data/index.ts'
import {
  contextUsagePercent,
  formatContextTokens,
  formatContextUsagePercent,
} from '../utils/context-usage.ts'

interface ContextUsageMeterProps {
  usage: ChatContextUsage
}

const categoryStyles = [
  ['系统提示词', 'bg-foreground/30'],
  ['工具', 'bg-[#a78bfa]'],
  ['对话消息', 'bg-accent'],
] as const

/** 展示最近一次成功运行持久化的上下文占用快照。 */
export function ContextUsageMeter({ usage }: ContextUsageMeterProps) {
  const percent = contextUsagePercent(usage.usedTokens, usage.contextWindow)
  const percentLabel = formatContextUsagePercent(percent)
  const categories = [
    { label: categoryStyles[0], tokens: usage.systemTokens },
    { label: categoryStyles[1], tokens: usage.toolsTokens },
    { label: categoryStyles[2], tokens: usage.messageTokens },
  ]
  const categoryTotal = categories.reduce(
    (total, category) => total + category.tokens,
    0,
  )
  const label = `上下文已用 ${percentLabel}`

  return (
    <Popover>
      <Popover.Trigger<'button'>
        aria-label={label}
        className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-transparent px-2 text-muted outline-none transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
        render={(props) => <button {...props} type="button" />}
        title={label}
      >
        <svg
          aria-hidden
          className="size-4 shrink-0 -rotate-90"
          viewBox="0 0 16 16"
        >
          <circle
            className="stroke-foreground/25"
            cx="8"
            cy="8"
            fill="none"
            r="6"
            strokeWidth="2"
          />
          <circle
            className="stroke-accent"
            cx="8"
            cy="8"
            fill="none"
            pathLength="100"
            r="6"
            strokeDasharray={`${percent} 100`}
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
        <span aria-hidden className="text-xs leading-none tabular-nums">
          {percentLabel}
        </span>
      </Popover.Trigger>
      <Popover.Content
        className="w-[min(16.5rem,calc(100vw-1.5rem))] rounded-2xl border border-divider bg-surface p-3.5 shadow-xl"
        offset={8}
        placement="top end"
      >
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="shrink-0 tabular-nums text-foreground">
            ~{formatContextTokens(usage.usedTokens)} /{' '}
            {formatContextTokens(usage.contextWindow)}
          </span>
        </div>
        <div
          aria-label={label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          aria-valuetext={percentLabel}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/15"
          role="progressbar"
        >
          <div className="flex h-full" style={{ width: `${percent}%` }}>
            {categoryTotal > 0
              ? categories.map((category) => (
                  <span
                    aria-hidden
                    className={category.label[1]}
                    key={category.label[0]}
                    style={{ flexGrow: category.tokens }}
                  />
                ))
              : null}
          </div>
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          {categories.map((category) => (
            <div
              className="flex items-center justify-between gap-4"
              key={category.label[0]}
            >
              <dt className="flex items-center gap-2 text-muted">
                <span
                  aria-hidden
                  className={`size-2 rounded-[2px] ${category.label[1]}`}
                />
                {category.label[0]}
              </dt>
              <dd className="tabular-nums text-foreground">
                ~{formatContextTokens(category.tokens)}
              </dd>
            </div>
          ))}
        </dl>
      </Popover.Content>
    </Popover>
  )
}
