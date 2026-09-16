import type { ReactNode } from 'react'
import { Card } from '@heroui/react'

interface SettingsItemCardProps {
  actions: ReactNode
  description: ReactNode
  icon: ReactNode
  isDisabled?: boolean
  openLabel?: string
  title: ReactNode
  onOpen?: () => void
}

/** 统一设置页条目的视觉结构和可选详情入口。 */
export function SettingsItemCard({
  actions,
  description,
  icon,
  isDisabled,
  onOpen,
  openLabel,
  title,
}: SettingsItemCardProps) {
  return (
    <Card
      className="relative flex min-h-16 flex-row items-center gap-3 rounded-xl !border !border-solid !border-foreground/15 bg-surface px-3 py-2.5 shadow-none"
      variant="transparent"
    >
      {onOpen && openLabel ? (
        <button
          type="button"
          aria-label={openLabel}
          disabled={isDisabled}
          className="absolute inset-0 z-0 h-full w-full cursor-[var(--cursor-interactive)] rounded-xl border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-[var(--cursor-disabled)]"
          onClick={onOpen}
        />
      ) : null}

      <div className="pointer-events-none relative z-10 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
        {icon}
      </div>
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {title}
        </div>
        <div className="mt-1 truncate text-xs leading-5 text-muted">
          {description}
        </div>
      </div>
      <div className="relative z-20 flex shrink-0 items-center gap-2">
        {actions}
      </div>
    </Card>
  )
}
