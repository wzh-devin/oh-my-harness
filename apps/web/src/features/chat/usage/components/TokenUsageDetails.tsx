import { Database } from 'lucide-react'
import type { ChatTokenUsage } from '../../types/chat-types.ts'
import { formatTokenUsage, tokenUsageDetails } from '../utils/token-usage.ts'

/** 复用会话与单轮真实用量明细。 */
export function TokenUsageDetails({
  usage,
  modelLabel,
  title = 'Token 用量',
}: {
  usage: ChatTokenUsage
  modelLabel?: string
  title?: string
}) {
  const { cacheHit, uncachedInput } = tokenUsageDetails(usage)
  const tokenRows = [
    ['缓存命中', cacheHit],
    ['未缓存输入', formatTokenUsage(uncachedInput)],
    ['缓存读取', formatTokenUsage(usage.cacheRead)],
    ['缓存写入', formatTokenUsage(usage.cacheWrite)],
    ['输出', formatTokenUsage(usage.output)],
  ]
  return (
    <>
      <div className="flex items-center justify-between gap-4 text-xs font-medium text-foreground">
        <span className="flex items-center gap-2">
          <Database aria-hidden className="size-3.5" />
          {title}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatTokenUsage(usage.total)}
        </span>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        {modelLabel ? (
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-muted">提供方 / 模型</dt>
            <dd className="min-w-0 break-all text-right text-foreground">
              {modelLabel}
            </dd>
          </div>
        ) : null}
        {tokenRows.map(([name, value]) => (
          <div className="flex items-center justify-between gap-4" key={name}>
            <dt className="text-muted">{name}</dt>
            <dd className="shrink-0 tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
