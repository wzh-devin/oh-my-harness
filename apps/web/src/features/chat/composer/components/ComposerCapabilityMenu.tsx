import type { RefObject } from 'react'
import { FilePlus, MagicWand, Plus, Terminal } from '@gravity-ui/icons'
import { ListBox, Popover } from '@heroui/react'
import type {
  ComposerCapability,
  ComposerCapabilityGroup,
} from '../capabilities/composer-capabilities.ts'

interface ComposerCapabilityMenuProps {
  activeId?: string
  anchorRef: RefObject<Element | null>
  groups: readonly ComposerCapabilityGroup[]
  isDisabled?: boolean
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSelect: (item: ComposerCapability) => void
}

const CAPABILITY_ICONS = {
  attachment: FilePlus,
  command: Terminal,
  skill: MagicWand,
} as const

/** 展示 Composer 的命令、文件与 Skills。 */
export function ComposerCapabilityMenu({
  activeId,
  anchorRef,
  groups,
  isDisabled,
  isOpen,
  onOpenChange,
  onSelect,
}: ComposerCapabilityMenuProps) {
  return (
    <Popover
      isOpen={!isDisabled && isOpen}
      onOpenChange={(open) => {
        if (!isDisabled) onOpenChange(open)
      }}
    >
      <Popover.Trigger
        aria-disabled={isDisabled}
        aria-label="添加内容"
        className="flex size-8 items-center justify-center rounded-lg bg-transparent text-muted outline-none transition hover:bg-surface-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none"
        tabIndex={isDisabled ? -1 : 0}
      >
        <Plus className="size-3.5" />
      </Popover.Trigger>
      <Popover.Content
        isNonModal
        className="w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-divider bg-surface p-1.5 shadow-xl"
        offset={8}
        placement="top start"
        triggerRef={anchorRef}
      >
        <div className="max-h-[min(21rem,46vh)] overflow-y-auto">
          {groups.length > 0 ? (
            groups.map((group) => (
              <section key={group.id} className="not-last:mb-1">
                <p className="px-2 py-0.5 text-[11px] font-medium leading-5 text-muted">
                  {group.label}
                </p>
                <ListBox aria-label={group.label}>
                  {group.items.map((item) => {
                    const Icon = CAPABILITY_ICONS[item.kind]

                    return (
                      <ListBox.Item
                        key={item.id}
                        aria-current={activeId === item.id ? 'true' : undefined}
                        className={`grid min-h-11 grid-cols-[1.5rem_minmax(6rem,8rem)_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1 sm:min-h-9 ${activeId === item.id ? 'bg-surface-secondary' : ''}`}
                        id={item.id}
                        textValue={item.label}
                        onAction={() => onSelect(item)}
                      >
                        <span className="flex size-6 items-center justify-center text-muted">
                          <Icon className="size-4" />
                        </span>
                        <span className="truncate text-sm text-foreground">
                          {item.label}
                        </span>
                        <span
                          className="truncate text-right text-xs text-muted"
                          title={item.description}
                        >
                          {item.description}
                        </span>
                      </ListBox.Item>
                    )
                  })}
                </ListBox>
              </section>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted">
              没有匹配的选项
            </p>
          )}
        </div>
      </Popover.Content>
    </Popover>
  )
}
