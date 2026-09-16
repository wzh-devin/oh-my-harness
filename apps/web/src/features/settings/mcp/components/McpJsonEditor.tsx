import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Label, TextField } from '@heroui/react'
import { MCP_CHANGE_KIND } from '@oh-my-harness/shared'
import { SettingsSubpageHeader } from '../../shared/components/SettingsBackNavigation.tsx'
import { mcpApi } from '../api/mcp-api.ts'
import type { useMcpSettings } from '../hooks/use-mcp-settings.ts'
import type { McpConfigVo, McpPreviewVo } from '../types/mcp-vo.ts'
import { McpJsonInput } from './McpJsonInput.tsx'

const changeLabels = {
  [MCP_CHANGE_KIND.ADD]: '新增',
  [MCP_CHANGE_KIND.UPDATE]: '修改',
  [MCP_CHANGE_KIND.DELETE]: '删除',
}

/** 对完整 JSON 草稿先预览再保存；删除项必须在对应预览中明确确认。 */
export function McpJsonEditor({
  config,
  state,
  onBack,
  onDirtyChange,
}: {
  config: McpConfigVo
  state: ReturnType<typeof useMcpSettings>
  onBack(): void
  onDirtyChange(dirty: boolean): void
}) {
  const [baseConfig, setBaseConfig] = useState(config)
  const original = JSON.stringify(
    { mcpServers: baseConfig.mcpServers },
    null,
    2,
  )
  const [source, setSource] = useState(original)
  const [preview, setPreview] = useState<McpPreviewVo>()
  const [confirmed, setConfirmed] = useState(false)
  const input = useRef<{ focus(): void } | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.error) errorMessage.current?.scrollIntoView({ block: 'nearest' })
    else if (preview) feedback.current?.scrollIntoView({ block: 'nearest' })
  }, [state.error, preview])
  const dirty = source !== original
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const deletedIds =
    preview?.changes
      .filter((change) => change.kind === MCP_CHANGE_KIND.DELETE)
      .map((change) => change.id) ?? []
  const existingKeys = Object.entries(baseConfig.secretKeys).flatMap(
    ([name, keys]) => [
      ...keys.env.map((key) => `${name} / env.${key}`),
      ...keys.headers.map((key) => `${name} / headers.${key}`),
    ],
  )

  /** 输入发生变化后废弃旧预览，防止保存与当前草稿不一致的确认结果。 */
  const changeSource = (value: string) => {
    state.setError('')
    setSource(value)
    setPreview(undefined)
    setConfirmed(false)
  }

  /** 格式化也先经过服务端严格解析，避免原生 stringify 吞掉重复键。 */
  const validate = async (format: boolean, refresh = false) => {
    setPreview(undefined)
    setConfirmed(false)
    const result = await state.run(async (signal) => {
      const latest = refresh ? await mcpApi.config(signal) : baseConfig
      const result = await mcpApi.preview(source, latest.revision, signal)
      if (refresh) setBaseConfig(latest)
      return result
    })
    if (!result) return
    if (format) setSource(JSON.stringify(JSON.parse(source), null, 2))
    setPreview(format ? undefined : result)
    setConfirmed(false)
  }
  /** 提交预览对应版本及删除确认，失败时保留草稿。 */
  const save = async () => {
    const result = await state.run((signal) =>
      mcpApi.replace(
        source,
        baseConfig.revision,
        confirmed ? deletedIds : [],
        signal,
      ),
    )
    if (result) {
      state.setList(result)
      onDirtyChange(false)
      onBack()
    }
  }

  return (
    <section>
      <SettingsSubpageHeader
        label="返回服务列表"
        isDisabled={state.busy}
        onBack={onBack}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base leading-6 font-medium text-foreground">
            JSON 配置
          </h2>
          <Button
            variant="outline"
            type="button"
            className="h-9 min-h-0 rounded-full px-3.5 text-sm"
            isDisabled={state.busy}
            onPress={() => {
              void validate(true)
            }}
          >
            格式化
          </Button>
        </div>
      </SettingsSubpageHeader>
      <p className="text-xs leading-[18px] text-muted mt-1">
        编辑完整服务配置，或粘贴已有的 mcpServers 配置。
      </p>
      {state.error ? (
        <div className="my-4">
          <p
            ref={errorMessage}
            className="break-words text-sm text-danger"
            role="alert"
          >
            {state.error}
          </p>
          {state.list && state.list.revision !== baseConfig.revision ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-9 min-h-0 rounded-full px-3.5 text-sm"
              isDisabled={state.busy}
              onPress={() => {
                void validate(false, true)
              }}
            >
              保留草稿，按最新配置重新预览
            </Button>
          ) : null}
        </div>
      ) : null}
      <TextField className="my-4 flex flex-col gap-2" isDisabled={state.busy}>
        <Label>
          <span className="text-xs leading-[18px] text-muted">
            应用级 MCP 配置
          </span>
        </Label>
        <McpJsonInput
          label="MCP JSON 配置"
          describedBy="mcp-json-hint"
          autoFocus
          value={source}
          isDisabled={state.busy}
          onChange={changeSource}
          editorRef={input}
        />
      </TextField>
      <p className="text-xs leading-[18px] text-muted" id="mcp-json-hint">
        已有密钥省略保留；填写新值替换；设为 null 清除。新服务未写 enabled
        时默认停用。
      </p>
      {existingKeys.length ? (
        <details className="text-xs leading-[18px] text-muted">
          <summary>已保存的凭据键（{existingKeys.length}）</summary>
          <ul>
            {existingKeys.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button
          variant="primary"
          type="button"
          className="h-9 min-h-0 rounded-full px-3.5 text-sm bg-foreground text-background hover:bg-foreground/90"
          isDisabled={state.busy}
          onPress={() => {
            void validate(false)
          }}
        >
          预览变更
        </Button>
      </div>
      {preview ? (
        <div
          ref={feedback}
          className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs"
          aria-label="配置变更预览"
        >
          <h3 className="text-sm font-medium text-foreground">
            即将应用的变更
          </h3>
          <div className="mt-4" role="status">
            {preview.changes.length
              ? preview.changes.map((change) => (
                  <div
                    key={`${change.kind}-${change.id}`}
                    className="mb-4 last:mb-0"
                  >
                    <p
                      className={
                        change.kind === MCP_CHANGE_KIND.DELETE
                          ? 'font-medium text-danger'
                          : 'font-medium'
                      }
                    >
                      {changeLabels[change.kind]}：{change.name}
                    </p>
                    <ul
                      className="mt-2 space-y-2"
                      aria-label={`${change.name} 的字段变更`}
                    >
                      {change.fields.map((field) => (
                        <li key={field.path} className="break-words">
                          <span>
                            {changeLabels[field.kind]}{' '}
                            <code className="font-mono">{field.path}</code>
                          </span>
                          {field.sensitive ? (
                            <span className="text-muted">（内容隐藏）</span>
                          ) : (
                            <div className="mt-1 font-mono text-xs">
                              {field.before !== undefined ? (
                                <p className="whitespace-pre-wrap text-muted">
                                  − {field.before}
                                </p>
                              ) : null}
                              {field.after !== undefined ? (
                                <p className="whitespace-pre-wrap">
                                  + {field.after}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              : '没有有效配置变更。格式、字段顺序和相同值不计入变更；省略已有 headers/env 会保留原值，删除某一项请设为 null。'}
          </div>
          {deletedIds.length ? (
            <Checkbox
              className="mt-4"
              isSelected={confirmed}
              isDisabled={state.busy}
              onChange={setConfirmed}
            >
              <Checkbox.Content className="flex items-center gap-2 text-xs">
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                确认删除未包含在 JSON 中的服务（{deletedIds.length} 个）
              </Checkbox.Content>
            </Checkbox>
          ) : null}
          <p className="text-xs leading-[18px] text-muted mt-4">
            保存后重连受影响的已启用服务；停用和删除立即阻止后续调用。
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Button
              variant="primary"
              type="button"
              className="h-9 min-h-0 rounded-full px-3.5 text-sm bg-foreground text-background hover:bg-foreground/90"
              isDisabled={
                state.busy ||
                !preview.changes.length ||
                (deletedIds.length > 0 && !confirmed)
              }
              onPress={() => {
                void save()
              }}
            >
              保存配置
            </Button>
            <Button
              variant="outline"
              type="button"
              className="h-9 min-h-0 rounded-full px-3.5 text-sm"
              isDisabled={state.busy}
              onPress={() => {
                setPreview(undefined)
                setConfirmed(false)
                input.current?.focus()
              }}
            >
              继续编辑
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
