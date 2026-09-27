import { SelectMenu } from '../../../../components/ui/index.ts'

interface SettingsSelectProps {
  description?: string
  isDisabled?: boolean
  label: string
  options: readonly { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

/** 展示通用设置项及其单选菜单。 */
export function SettingsSelect({
  description,
  isDisabled,
  label,
  onChange,
  options,
  value,
}: SettingsSelectProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-divider py-6 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      <SelectMenu
        ariaLabel={label}
        className="w-full shrink-0 sm:w-auto sm:min-w-40"
        isDisabled={isDisabled}
        options={options}
        triggerClassName="w-full bg-surface-secondary sm:w-auto"
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
