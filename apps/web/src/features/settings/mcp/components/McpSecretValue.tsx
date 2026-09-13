import { useEffect, useState } from 'react'
import { Button, Popover } from '@heroui/react'
import type { McpJsonCodeEditorProps } from '../types/mcp-json-editor-props.ts'
import { SAVED_SECRET } from '../utils/secret-editor.ts'

/** 仅在浮层打开时读取单项值；关闭或卸载即取消请求并移除显示值。 */
export function McpSecretValue({
  secretKey,
  readSecret,
  isDisabled,
}: {
  secretKey: string
  readSecret: NonNullable<McpJsonCodeEditorProps['readSecret']>
  isDisabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void readSecret(secretKey, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setValue(result.value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('读取失败，请关闭后重试。')
      })
    return () => controller.abort()
  }, [open, secretKey, readSecret])
  const changeOpen = (next: boolean) => {
    setValue(undefined)
    setError('')
    setOpen(next)
  }
  return (
    <Popover isOpen={open} onOpenChange={changeOpen}>
      <Button
        variant="ghost"
        type="button"
        size="sm"
        className="h-5 min-h-0 rounded-md px-1 align-baseline font-mono text-sm font-normal text-muted"
        aria-label={`查看 ${secretKey} 的值`}
        isDisabled={isDisabled}
      >
        "{SAVED_SECRET}"
      </Button>
      <Popover.Content placement="bottom start" offset={6}>
        <Popover.Dialog
          className="w-[min(20rem,calc(100vw-3rem))] p-3"
          aria-label={`${secretKey} 凭据详情`}
        >
          <div className="flex items-center justify-between gap-3">
            <Popover.Heading className="min-w-0 break-all text-sm font-medium">
              {secretKey}
            </Popover.Heading>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 rounded-full"
              onPress={() => changeOpen(false)}
            >
              隐藏
            </Button>
          </div>
          <div
            className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-secondary p-3 font-mono text-xs whitespace-pre-wrap break-all"
            role="status"
          >
            {error || (value === undefined ? '正在读取…' : value || '（空值）')}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
