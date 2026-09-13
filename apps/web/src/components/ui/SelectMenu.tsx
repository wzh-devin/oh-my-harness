import type { ReactNode } from 'react'
import { Label, ListBox, Select } from '@heroui/react'

interface SelectMenuOption {
  id: string
  label: string
}

interface SelectMenuProps {
  ariaLabel: string
  className?: string
  isDisabled?: boolean
  options: readonly SelectMenuOption[]
  startContent?: ReactNode
  triggerClassName?: string
  value: string
  onChange: (value: string) => void
}

export function SelectMenu({
  ariaLabel,
  className,
  isDisabled,
  onChange,
  options,
  startContent,
  triggerClassName,
  value,
}: SelectMenuProps) {
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      isDisabled={isDisabled}
      selectedKey={value}
      variant="secondary"
      onSelectionChange={(key) => {
        if (key != null) onChange(String(key))
      }}
    >
      <Select.Trigger
        className={`justify-between ${startContent ? 'pr-7' : ''} ${triggerClassName ?? ''}`}
      >
        {startContent ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {startContent}
            <Select.Value />
          </span>
        ) : (
          <Select.Value />
        )}
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover
        placement="bottom start"
        className="min-w-(--trigger-width) rounded-xl"
      >
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              className="rounded-lg pe-2 data-[focus-visible=true]:ring-0 data-[focus-visible=true]:ring-offset-0 data-[focus-visible=true]:bg-default"
              id={option.id}
              textValue={option.label}
            >
              <Label className="min-w-0 flex-1 break-words font-normal">
                {option.label}
              </Label>
              <ListBox.ItemIndicator className="static translate-y-0" />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
