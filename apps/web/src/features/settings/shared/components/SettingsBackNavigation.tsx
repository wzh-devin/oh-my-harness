import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

interface SettingsBackButtonProps {
  label: string
  onBack: () => void
  isDisabled?: boolean
}

/** 统一设置页的返回入口，避免幽灵按钮的整块悬停和按压动画。 */
export function SettingsBackButton({
  label,
  onBack,
  isDisabled,
}: SettingsBackButtonProps) {
  return (
    <button
      type="button"
      disabled={isDisabled}
      className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md bg-transparent p-0 text-left text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-[var(--cursor-disabled)] disabled:opacity-50"
      onClick={onBack}
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  )
}

interface SettingsSubpageHeaderProps extends SettingsBackButtonProps {
  children: ReactNode
}

/** 统一返回入口与次级页面标题的纵向间距。 */
export function SettingsSubpageHeader({
  children,
  ...backProps
}: SettingsSubpageHeaderProps) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsBackButton {...backProps} />
      {children}
    </div>
  )
}
