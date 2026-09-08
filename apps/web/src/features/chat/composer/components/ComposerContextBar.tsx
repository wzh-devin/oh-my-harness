import {
  CircleExclamation,
  CircleFill,
  MagicWand,
  PlugConnection,
  Puzzle,
  Terminal,
  Xmark,
} from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { COMPOSER_CAPABILITY_KIND } from '@oh-my-harness/shared'
import type {
  ComposerContextItem,
  ComposerContextKind,
} from '../capabilities/composer-capabilities.ts'

type ComposerContextDisplayItem = ComposerContextItem & {
  unavailableReason?: string | null
}

interface ComposerContextBarProps {
  className?: string
  isDisabled?: boolean
  items: readonly ComposerContextDisplayItem[]
  onRemove?: (id: string) => void
}

const CONTEXT_ICONS = {
  command: Terminal,
  mcp: PlugConnection,
  plugin: Puzzle,
  skill: MagicWand,
} satisfies Record<ComposerContextKind, typeof Terminal>

/** 以统一 Token 展示消息的命令、Skill、MCP 与插件上下文。 */
export function ComposerContextBar({
  className,
  isDisabled,
  items,
  onRemove,
}: ComposerContextBarProps) {
  if (items.length === 0) return null

  return (
    <div
      aria-label="已选择的上下文"
      className={`flex h-7 max-w-full items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ''}`}
      role="list"
    >
      {items.map((item) => {
        const Icon = CONTEXT_ICONS[item.kind]
        const label = item.label
        const title = item.unavailableReason
          ? `${label}：${item.unavailableReason}`
          : `${label}（${item.reference}）：${item.description}`

        return (
          <div
            key={item.id}
            className="group flex h-7 shrink-0 items-center gap-1.5"
            role="listitem"
            title={title}
          >
            {onRemove ? (
              <Button
                isIconOnly
                aria-label={`移除上下文：${label}`}
                className={`group/remove size-6 min-w-6 rounded-md ${item.unavailableReason ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'} hover:bg-danger/10 hover:text-danger`}
                isDisabled={isDisabled}
                size="sm"
                variant="ghost"
                onPress={() => onRemove(item.id)}
              >
                <Icon
                  aria-hidden
                  className="size-3.5 group-hover/remove:hidden"
                />
                <Xmark className="hidden size-3.5 group-hover/remove:block" />
              </Button>
            ) : (
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-md ${item.unavailableReason ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}
              >
                <Icon aria-hidden className="size-3.5" />
              </span>
            )}
            <span
              className={`max-w-36 truncate text-sm font-medium leading-7 ${item.unavailableReason ? 'text-danger' : 'text-accent'}`}
            >
              {label}
            </span>
            {item.unavailableReason ? (
              <CircleExclamation
                aria-label={item.unavailableReason}
                className="size-3.5 shrink-0"
                role="img"
              />
            ) : item.kind === COMPOSER_CAPABILITY_KIND.MCP ? (
              <CircleFill
                aria-label="MCP 已连接"
                className="size-1.5 shrink-0 text-success"
                role="img"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
