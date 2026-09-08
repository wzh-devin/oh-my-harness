import { useRef } from 'react'
import { Plus } from '@gravity-ui/icons'
import { Button, Form, Input, Label, TextField } from '@heroui/react'
import {
  PLUGIN_IMPORT_KIND,
  PLUGIN_IMPORT_STATUS,
  type PluginImportKind,
} from '@oh-my-harness/shared'
import { SelectMenu } from '../../../../components/ui/index.ts'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'
import { usePluginImport } from '../hooks/use-plugin-import.ts'

/** 复用设置页内联编辑器、选择器和操作栏导入插件内容。 */
export function PluginImportForm({
  onInstalled,
  onClose,
  replaceId,
  replaceKind,
}: {
  onInstalled(): void
  onClose(): void
  replaceId?: string
  replaceKind?: PluginImportKind
}) {
  const input = useRef<HTMLInputElement>(null)
  const {
    source,
    setSource,
    file,
    setFile,
    imported,
    candidate,
    setCandidate,
    preview,
    setPreview,
    busy,
    error,
    setError,
    submit,
    install,
  } = usePluginImport(onInstalled, replaceId, replaceKind)
  const ready = imported?.status === PLUGIN_IMPORT_STATUS.READY && !!preview
  const disabled =
    busy ||
    (imported ? !ready || preview?.blocked === true : !source.trim() && !file)
  return (
    <SettingsEditorCard>
      <Form
        aria-label="导入市场或插件"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!disabled) void (imported ? install() : submit())
        }}
      >
        <div>
          <h3 className="text-sm leading-[22px] font-medium text-foreground">
            {replaceId ? '替换已安装版本' : '导入市场或插件'}
          </h3>
          <p className="mt-1 text-xs leading-[18px] text-muted">
            支持原生、Codex、Claude 格式。导入不会运行脚本，安装后需启用。
          </p>
        </div>
        <TextField
          value={source}
          onChange={(value) => {
            setSource(value)
            if (value) setFile(null)
          }}
          isDisabled={busy || !!imported}
        >
          <Label>GitHub / Git 地址</Label>
          <Input
            autoFocus
            placeholder="owner/repo 或 HTTPS 仓库地址"
            variant="secondary"
          />
        </TextField>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">
            或导入 ZIP 文件
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <input
              ref={input}
              type="file"
              className="hidden"
              accept=".zip"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setSource('')
              }}
            />
            <Button
              className="h-8 min-h-0 shrink-0 rounded-full px-3 text-xs"
              type="button"
              variant="outline"
              isDisabled={busy || !!imported}
              onPress={() => input.current?.click()}
            >
              <Plus className="size-4" />
              选择 ZIP 文件
            </Button>
            <span className="truncate text-xs text-muted" title={file?.name}>
              {file?.name ?? '未选择文件'}
            </span>
          </div>
        </div>
        {imported?.status === PLUGIN_IMPORT_STATUS.FETCHING ? (
          <p role="status" className="text-sm text-muted">
            正在获取并检查文件…
          </p>
        ) : null}
        {imported?.status === PLUGIN_IMPORT_STATUS.READY ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">
              导入入口
            </span>
            <SelectMenu
              ariaLabel="导入入口"
              isDisabled={busy}
              triggerClassName="w-full"
              value={candidate}
              options={[
                { id: '', label: '请选择入口' },
                ...imported.candidates.map((item) => ({
                  id: item.key,
                  label: `${item.kind === PLUGIN_IMPORT_KIND.MARKETPLACE ? '市场' : '插件'} · ${item.format} · ${item.root === '.' ? '根目录' : item.root}`,
                })),
              ]}
              onChange={(value) => {
                setPreview(null)
                setError('')
                setCandidate(value)
              }}
            />
          </div>
        ) : null}
        {preview ? (
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-foreground">{preview.name}</span>
            <p className="text-xs text-muted">
              {preview.entries
                ? `${preview.entries.length} 个市场条目`
                : `${preview.skills} 个技能入口 · ${preview.servers?.length ?? 0} 个连接`}
            </p>
            {preview.compatibility?.map((item, index) => (
              <p key={index} className="text-xs text-muted">
                {item.message}
              </p>
            ))}
          </div>
        ) : null}
        {error || imported?.error ? (
          <p role="alert" className="text-sm text-danger">
            {error || imported?.error}
          </p>
        ) : null}
        <SettingsEditorActions
          onCancel={onClose}
          isDisabled={disabled}
          submitLabel={
            busy
              ? '处理中…'
              : !imported
                ? '预览导入'
                : replaceId
                  ? '确认替换'
                  : preview?.entries
                    ? '添加市场'
                    : '安装插件'
          }
        />
      </Form>
    </SettingsEditorCard>
  )
}
