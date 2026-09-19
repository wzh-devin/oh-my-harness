import { Popover } from '@heroui/react'
import { Database } from 'lucide-react'
import type { ChatTokenUsage } from '../../types/chat-types.ts'
import { TokenUsageDetails } from '../../usage/components/index.ts'
import { formatTokenUsage } from '../../usage/utils/token-usage.ts'

/** 在回复操作栏展示本轮所有模型调用的总量，并可展开明细。 */
export function MessageTokenUsage({
  usage,
  modelId,
  providerId,
}: {
  usage: ChatTokenUsage
  modelId?: string
  providerId?: string
}) {
  return (
    <Popover>
      <Popover.Trigger<'button'>
        aria-label={`本轮回复 Token 用量 ${formatTokenUsage(usage.total)}`}
        className="ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs text-foreground/75 outline-none hover:bg-surface-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        render={(props) => <button {...props} type="button" />}
      >
        <Database aria-hidden className="size-3.5" />
        <span className="text-xs tabular-nums">
          {formatTokenUsage(usage.total)}
        </span>
      </Popover.Trigger>
      <Popover.Content
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-divider bg-surface p-3.5 shadow-xl"
        placement="top"
        offset={8}
      >
        <Popover.Dialog aria-label="本轮回复 Token 用量" className="p-0">
          <TokenUsageDetails
            usage={usage}
            title="本轮用量"
            modelLabel={
              providerId && modelId ? `${providerId}/${modelId}` : undefined
            }
          />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
