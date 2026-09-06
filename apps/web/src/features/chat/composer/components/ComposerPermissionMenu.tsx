import { ChevronDown } from '@gravity-ui/icons'
import { Hand, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Dropdown } from '@heroui/react'
import {
  PERMISSION_OPTIONS,
  type PermissionId,
  usePermissionSettings,
} from '../../../settings/index.ts'

const PERMISSION_ICONS = {
  'read-only': Hand,
  'workspace-write': ShieldCheck,
  'full-access': ShieldAlert,
} as const
interface ComposerPermissionMenuProps {
  activePermission?: PermissionId
  isDisabled: boolean
}

/** 显示服务端固定的本轮权限，或选择下一轮的审批模式。 */
export function ComposerPermissionMenu({
  activePermission,
  isDisabled,
}: ComposerPermissionMenuProps) {
  const { permission, setPermission } = usePermissionSettings()
  const selectedId = activePermission ?? permission
  const selectedPermission =
    PERMISSION_OPTIONS.find((option) => option.id === selectedId) ??
    PERMISSION_OPTIONS[1]
  const PermissionIcon = PERMISSION_ICONS[selectedPermission.id]
  const fullAccess = selectedPermission.id === 'full-access'

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={`${activePermission ? '本轮权限' : '权限'}：${selectedPermission.label}`}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-transparent px-2 !text-sm outline-none transition-colors hover:bg-surface-secondary focus-visible:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus ${fullAccess ? 'text-orange-600 dark:text-orange-400' : 'text-muted hover:text-foreground'}`}
        isDisabled={isDisabled || Boolean(activePermission)}
      >
        <PermissionIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="hidden whitespace-nowrap @sm:inline">
          {selectedPermission.label}
        </span>
        <ChevronDown aria-hidden className="hidden size-3 shrink-0 @sm:block" />
      </Dropdown.Trigger>
      <Dropdown.Popover
        className="min-w-56 w-[min(21rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)]"
        placement="top start"
      >
        <Dropdown.Menu
          aria-label="审批模式"
          selectionMode="single"
          selectedKeys={[selectedId]}
          onAction={(key) => {
            const option = PERMISSION_OPTIONS.find(
              (candidate) => candidate.id === key,
            )
            if (option && !isDisabled && !activePermission)
              setPermission(option.id)
          }}
        >
          {PERMISSION_OPTIONS.map((option) => {
            const Icon = PERMISSION_ICONS[option.id]
            const warning = option.id === 'full-access'
            return (
              <Dropdown.Item
                key={option.id}
                id={option.id}
                aria-label={option.label}
                aria-describedby={`permission-description-${option.id}`}
                textValue={option.label}
                className="items-center gap-2.5 !ps-2.5"
              >
                <Icon
                  aria-hidden
                  className={`size-4 shrink-0 ${warning ? 'text-orange-600 dark:text-orange-400' : 'text-muted'}`}
                />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm leading-5 text-foreground">
                    {option.label}
                  </span>
                  <span
                    id={`permission-description-${option.id}`}
                    className="mt-0.5 block whitespace-normal text-xs leading-[18px] text-muted"
                  >
                    {option.description}
                  </span>
                </div>
                <Dropdown.ItemIndicator className="static translate-y-0" />
              </Dropdown.Item>
            )
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
