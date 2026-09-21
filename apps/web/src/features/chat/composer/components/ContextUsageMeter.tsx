import { Popover } from '@heroui/react'
import type {
  ChatContextUsage,
  ChatTokenUsage,
} from '../../types/chat-types.ts'
import {
  contextUsagePercent,
  formatContextTokens,
  formatContextUsagePercent,
} from '../utils/context-usage.ts'
import { TokenUsageDetails } from '../../usage/components/index.ts'

interface ContextUsageMeterProps {
  usage?: ChatContextUsage
  tokenUsage?: ChatTokenUsage
}

const categoryStyles = [
  ['系统提示词', 'bg-foreground/30'],
  ['工具', 'bg-[#a78bfa]'],
  ['对话消息', 'bg-accent'],
] as const

/** 展示当前上下文估算和整个会话的真实累计用量。 */
export function ContextUsageMeter({
  usage,
  tokenUsage,
}: ContextUsageMeterProps) {
  const percent = usage
    ? contextUsagePercent(usage.usedTokens, usage.contextWindow)
    : undefined
  const percentLabel = formatContextUsagePercent(percent)
  const categories = [
    { label: categoryStyles[0], tokens: usage?.systemTokens ?? 0 },
    { label: categoryStyles[1], tokens: usage?.toolsTokens ?? 0 },
    { label: categoryStyles[2], tokens: usage?.messageTokens ?? 0 },
  ]
  const categoryTotal = categories.reduce(
    (total, category) => total + category.tokens,
    0,
  )
  const label = usage ? `上下文已用 ${percentLabel}` : '上下文用量待更新'

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
            strokeDasharray={`${percent ?? 0} 100`}
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
        <span aria-hidden className="text-xs leading-none tabular-nums">
          {percentLabel}
        </span>
      </Popover.Trigger>
      <Popover.Content
        className="max-h-[calc(100dvh-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-divider bg-surface p-3.5 shadow-xl"
        offset={8}
        placement="top end"
      >
        <Popover.Dialog aria-label="上下文与 Token 用量" className="p-0">
          {usage ? (
            <>
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
                {usage.inputLimit === undefined ? null : (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted">输入上限</dt>
                    <dd className="tabular-nums text-foreground">
                      ~{formatContextTokens(usage.inputLimit)}
                    </dd>
                  </div>
                )}
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
            </>
          ) : null}
          {tokenUsage ? (
            <div
              className={
                usage ? 'mt-3.5 border-t border-divider pt-3.5' : undefined
              }
            >
              <TokenUsageDetails usage={tokenUsage} />
            </div>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
