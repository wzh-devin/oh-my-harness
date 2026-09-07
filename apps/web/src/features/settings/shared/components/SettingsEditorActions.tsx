import { Button } from '@heroui/react'

interface SettingsEditorActionsProps {
  className?: string
  onCancel: () => void
  submitLabel?: string
  isDisabled?: boolean
}

/** 使用项目的小尺寸胶囊按钮结束设置编辑。 */
export function SettingsEditorActions({
  className,
  onCancel,
  submitLabel = '保存',
  isDisabled = false,
}: SettingsEditorActionsProps) {
  return (
    <div className={`flex justify-end gap-2 ${className ?? ''}`}>
      <Button
        className="h-9 min-h-0 rounded-full px-3.5 text-sm"
        type="button"
        variant="outline"
        onPress={onCancel}
      >
        取消
      </Button>
      <Button
        className="h-9 min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
        type="submit"
        isDisabled={isDisabled}
      >
        {submitLabel}
      </Button>
    </div>
  )
}
