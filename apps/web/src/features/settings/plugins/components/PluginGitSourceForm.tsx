import { useEffect, useState, type FormEvent } from 'react'
import {
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'

/** 市场和单个插件共用同一 Git 来源表单与草稿保护。 */
export function PluginGitSourceForm({
  kind,
  busy,
  error,
  onSubmit,
  onCancel,
  onDirtyChange,
}: {
  kind: 'market' | 'plugin'
  busy: boolean
  error?: string
  onSubmit(source: { url: string; ref: string; path: string }): Promise<void>
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const market = kind === 'market'
  const defaultPath = market ? '' : '.'
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [path, setPath] = useState(defaultPath)
  const dirty = !!url || !!ref || path !== defaultPath
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy)
      void onSubmit({ url: url.trim(), ref: ref.trim(), path: path.trim() })
  }
  return (
    <SettingsEditorCard>
      <Form
        aria-label={market ? '添加插件市场' : '安装单个插件'}
        className="flex flex-col gap-5"
        onSubmit={submit}
      >
        <h3 className="text-sm font-medium text-foreground">
          {market ? '添加插件市场' : '安装单个插件'}
        </h3>
        <TextField isRequired isDisabled={busy} name="gitUrl">
          <Label>Git 仓库</Label>
          <Input
            autoFocus
            placeholder="https://github.com/owner/repo"
            value={url}
            variant="secondary"
            onChange={(event) => setUrl(event.target.value)}
          />
          <Description>支持 GitHub、GitLab、Bitbucket 的公开仓库。</Description>
          <FieldError />
        </TextField>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextField isDisabled={busy} name="gitRef">
            <Label>分支或标签</Label>
            <Input
              placeholder="默认分支"
              value={ref}
              variant="secondary"
              onChange={(event) => setRef(event.target.value)}
            />
          </TextField>
          <TextField isDisabled={busy} name="gitPath">
            <Label>{market ? '目录文件' : '插件目录'}</Label>
            <Input
              placeholder={market ? '自动识别市场目录' : defaultPath}
              value={path}
              variant="secondary"
              onChange={(event) => setPath(event.target.value)}
            />
            <FieldError />
          </TextField>
        </div>
        <Description>
          {market
            ? '自动识别 marketplace.json、.agents/plugins/marketplace.json 或 .claude-plugin/marketplace.json；也可填写明确目录文件。'
            : '支持本应用、Codex 和 Claude Code 插件清单；读取成功后先预览，再确认安装。'}
        </Description>
        {error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {error}
          </p>
        ) : null}
        <SettingsEditorActions
          submitLabel={
            busy
              ? market
                ? '正在读取市场…'
                : '正在读取插件…'
              : market
                ? '添加市场'
                : '检查插件'
          }
          isDisabled={busy}
          onCancel={onCancel}
        />
      </Form>
    </SettingsEditorCard>
  )
}
