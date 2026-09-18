import { PluginIcon } from './PluginIcon.tsx'
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { SettingsSubpageHeader } from '../../shared/components/SettingsBackNavigation.tsx'
import {
  MCP_AUTH_POLICY,
  MCP_CONNECTION_STATUS,
  PLUGIN_INSTALLATION_SOURCE_KIND,
  PLUGIN_OPERATION_STATUS,
  PLUGIN_SOURCE_KIND,
} from '@oh-my-harness/shared'
import { pluginApi } from '../api/plugin-api.ts'
import { McpConnectionPanel } from '../../mcp/components/McpConnectionPanel.tsx'
import type {
  PluginEntryVo,
  PluginInstallationVo,
  PluginManifestVo,
} from '../types/plugin-vo.ts'
import type { usePluginSettings } from '../hooks/use-plugin-settings.ts'

/** 按已校验清单展示组件和启动方式，不渲染插件提供的 HTML 或脚本。 */
const ManifestDetails = ({ manifest }: { manifest: PluginManifestVo }) => (
  <>
    <p className="text-xs text-muted">
      格式：
      {manifest.format === 'codex'
        ? 'Codex'
        : manifest.format === 'claude-code'
          ? 'Claude Code'
          : '本应用'}
    </p>
    <p className="break-words text-sm text-muted">{manifest.description}</p>
    <p className="text-xs text-muted">
      {manifest.author} · {manifest.license} · v{manifest.version}
    </p>
    {manifest.requirements ? (
      <p className="rounded-xl bg-surface-secondary p-3 text-sm">
        {manifest.requirements}
      </p>
    ) : null}
    {manifest.examples.length ? (
      <div className="space-y-2">
        <p className="text-sm font-medium">可以这样使用</p>
        {manifest.examples.map((example) => (
          <p
            key={example}
            className="rounded-xl bg-surface-secondary p-3 text-sm"
          >
            {example}
          </p>
        ))}
      </div>
    ) : null}
    <div className="space-y-2">
      <p className="text-sm font-medium">包含的能力</p>
      {manifest.skills.map((path) => (
        <p key={path} className="break-all text-sm text-muted">
          Skill · {path.split('/').at(-1)}
        </p>
      ))}
      {Object.entries(manifest.mcpServers).map(([name, server]) => (
        <div key={name} className="rounded-xl border border-divider p-3">
          <p className="text-sm font-medium">MCP · {name}</p>
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">
            {server.url ??
              JSON.stringify(
                { command: server.command, args: server.args ?? [] },
                null,
                2,
              )}
          </pre>
          {!server.url ? (
            <p className="mt-2 text-xs text-muted">
              启用将运行以上本地程序；启动器可能下载依赖。请确认来源和环境要求。
            </p>
          ) : null}
        </div>
      ))}
      {manifest.hooks.map((hook, index) => (
        <div
          key={`${hook.event}-${index}`}
          className="rounded-xl border border-divider p-3"
        >
          <p className="text-sm font-medium">命令 Hook · {hook.event}</p>
          {hook.matcher ? (
            <p className="mt-1 text-xs text-muted">触发：{hook.matcher}</p>
          ) : null}
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">
            {hook.command}
          </pre>
          <p className="mt-2 text-xs text-muted">
            最长运行 {hook.timeout} 秒；安装和启用后仍需单独信任当前版本。
          </p>
        </div>
      ))}
      {manifest.unavailable.map((item) => (
        <p key={item} className="text-sm text-muted">
          暂不支持 · {item}
        </p>
      ))}
    </div>
  </>
)

/** 配置只保留于当前表单，使用打开详情时的修订号防止覆盖其他修改。 */
export function PluginDetail({
  entry,
  installation,
  state,
  backLabel,
  onBack,
  onInstalled,
  showConnectionGuide,
  onDirtyChange,
}: {
  entry?: PluginEntryVo
  installation?: PluginInstallationVo
  state: ReturnType<typeof usePluginSettings>
  backLabel: string
  onBack(): void
  onInstalled(id: string, connect: boolean): void
  showConnectionGuide?: boolean
  onDirtyChange(dirty: boolean): void
}) {
  const [values, setValues] = useState<Record<string, string | null>>({})
  const [revision, setRevision] = useState(installation?.revision)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [notice, setNotice] = useState('')
  const dirty = Object.keys(values).length > 0
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const operation = state.operation
  const currentEntry =
    operation?.entry ??
    entry ??
    state.catalog?.entries.find((item) => item.id === installation?.entryId)
  const manifest = operation?.manifest ?? installation?.manifest
  const preparing = operation?.status === PLUGIN_OPERATION_STATUS.FETCHING
  const prepared = operation?.status === PLUGIN_OPERATION_STATUS.READY
  const upToDate =
    prepared &&
    !!operation?.previousVersion &&
    operation.previousVersion === manifest?.version
  const entryId = currentEntry?.id ?? installation?.entryId
  const source = operation?.source ?? installation?.source
  const directSource =
    installation?.source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
      ? installation.source
      : undefined
  const busy = state.busy
  const actionError = state.error ? (
    <p role="alert" className="w-full break-words text-sm text-danger">
      {state.error}
    </p>
  ) : null

  /** 成功写入后清空凭据草稿，采用服务端新修订；失败时保留原输入。 */
  const save = async (enabled?: boolean) => {
    if (!installation || revision === undefined) return
    const result = await state.mutate((signal) =>
      pluginApi.update(signal, installation.id, revision, {
        ...(enabled === undefined ? {} : { enabled }),
        values,
      }),
    )
    if (result) {
      setRevision(
        result.installations.find((item) => item.id === installation.id)
          ?.revision,
      )
      setValues({})
      setNotice('配置已保存。连接状态会自动刷新。')
    }
  }
  const trustHooks = async (trusted: boolean) => {
    if (!installation || revision === undefined) return
    const result = await state.mutate((signal) =>
      pluginApi.trustHooks(signal, installation.id, revision, trusted),
    )
    if (result) {
      setRevision(
        result.installations.find((item) => item.id === installation.id)
          ?.revision,
      )
      setNotice(
        trusted ? '当前版本的命令 Hooks 已信任。' : '命令 Hooks 已停止。',
      )
    }
  }
  /** 安装完成后进入已安装详情，按市场策略展示连接引导。 */
  const commit = async () => {
    if (!operation) return
    const result = await state.mutate((signal) =>
      pluginApi.commit(signal, operation.id),
    )
    if (result) {
      await state.cancel()
      const installed = result.installations.find(
        (item) => item.entryId === operation.entry?.id,
      )
      if (installed)
        onInstalled(
          installed.id,
          installed.servers.length > 0 &&
            currentEntry?.authentication !== MCP_AUTH_POLICY.ON_USE,
        )
      else onBack()
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="插件详情">
      <SettingsSubpageHeader
        label={backLabel}
        onBack={onBack}
        isDisabled={busy}
      >
        <h2 className="break-words text-base font-medium">
          {manifest?.displayName ??
            currentEntry?.displayName ??
            installation?.manifest.displayName ??
            '正在读取插件'}
        </h2>
      </SettingsSubpageHeader>
      {source?.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT ? (
        <p className="break-all text-xs text-muted">
          来源：直接安装
          {' · '}
          <a
            className="underline underline-offset-2"
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            查看仓库
          </a>
          {source.commit ? ` · ${source.commit.slice(0, 7)}` : null}
        </p>
      ) : currentEntry ? (
        <p className="break-all text-xs text-muted">
          来源：
          {state.catalog?.markets.find(
            (market) => market.id === currentEntry.market,
          )?.builtIn
            ? '官方市场'
            : (state.catalog?.markets.find(
                (market) => market.id === currentEntry.market,
              )?.name ?? currentEntry.market)}
          {currentEntry.source.url ? (
            <>
              {' '}
              ·{' '}
              <a
                className="underline underline-offset-2"
                href={currentEntry.source.url}
                target="_blank"
                rel="noreferrer"
              >
                查看仓库
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {installation?.servers.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">连接服务</h3>
          {installation.servers.map((server) => (
            <McpConnectionPanel
              key={server.id}
              server={server}
              icon={
                <PluginIcon
                  installationId={installation.id}
                  iconId={currentEntry?.iconId}
                  iconDarkId={currentEntry?.iconDarkId}
                />
              }
              highlighted={showConnectionGuide}
              onEnable={!installation.enabled ? () => save(true) : undefined}
            />
          ))}
        </div>
      ) : null}
      {manifest ? (
        <ManifestDetails manifest={manifest} />
      ) : (
        <>
          <p className="text-sm text-muted">{currentEntry?.description}</p>
          {currentEntry?.version ? (
            <p className="text-xs text-muted">v{currentEntry.version}</p>
          ) : (
            <p className="text-xs text-muted">版本将在安装预览时确定。</p>
          )}
        </>
      )}
      {installation?.error ? (
        <p role="alert" className="text-sm text-danger">
          {installation.error}
        </p>
      ) : null}
      {currentEntry?.source.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED ? (
        <p role="status" className="text-sm text-muted">
          {currentEntry.source.reason}
        </p>
      ) : null}
      {preparing ? (
        <p role="status" className="text-sm text-muted">
          正在下载并校验插件…
        </p>
      ) : null}
      {operation?.error ? (
        <p role="alert" className="text-sm text-danger">
          {operation.error}
        </p>
      ) : null}
      {operation?.resetConfiguration ? (
        <p className="rounded-xl bg-surface-secondary p-3 text-sm">
          服务目标或配置声明发生变化。更新后会清除当前配置并停用，请重新配置后启用。
        </p>
      ) : null}
      {!installation || operation ? actionError : null}
      {upToDate ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">当前已是最新版本。</p>
          <Button
            variant="outline"
            className="h-9 w-fit min-h-0 rounded-full px-3.5 text-sm"
            isDisabled={busy}
            onPress={() => void state.cancel()}
          >
            完成
          </Button>
        </div>
      ) : prepared ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {operation?.previousVersion
              ? `当前 v${operation.previousVersion} → v${manifest?.version}。请检查更新后的能力和启动方式。`
              : '安装后默认未启用。请检查以上能力和启动方式。'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="h-9 min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
              isDisabled={busy}
              onPress={() => void commit()}
            >
              确认{operation?.previousVersion ? '更新' : '安装'}
            </Button>
            <Button
              variant="outline"
              className="h-9 min-h-0 rounded-full px-3.5 text-sm"
              isDisabled={busy}
              onPress={() => void state.cancel()}
            >
              取消
            </Button>
          </div>
        </div>
      ) : preparing ? (
        <Button
          variant="outline"
          className="h-9 w-fit min-h-0 rounded-full px-3.5 text-sm"
          isDisabled={busy}
          onPress={() => void state.cancel()}
        >
          取消下载
        </Button>
      ) : !installation ? (
        <Button
          variant="primary"
          className="h-9 w-fit min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
          isDisabled={
            busy ||
            !entryId ||
            currentEntry?.source.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED
          }
          onPress={() => {
            if (entryId) void state.prepare(entryId)
          }}
        >
          检查并准备安装
        </Button>
      ) : null}
      {installation && !operation ? (
        <>
          {installation.manifest.inputs.length ? (
            <div className="space-y-4 border-t border-divider pt-4">
              <p className="text-sm font-medium">插件配置</p>
              {installation.manifest.inputs.map((input) => (
                <div key={input.key}>
                  <TextField
                    isDisabled={busy}
                    className="w-full"
                    name={input.key}
                  >
                    <Label>
                      {input.label}
                      {input.required ? ' *' : ''}
                    </Label>
                    <Input
                      type={input.secret ? 'password' : 'text'}
                      variant="secondary"
                      autoComplete="off"
                      value={values[input.key] ?? ''}
                      placeholder={
                        values[input.key] === null
                          ? '保存后清除'
                          : installation.configuredKeys.includes(input.key)
                            ? '已配置，留空保留'
                            : '尚未配置'
                      }
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setValues((previous) => {
                          const next = { ...previous }
                          if (value) next[input.key] = value
                          else delete next[input.key]
                          return next
                        })
                      }}
                    />
                  </TextField>
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="text-xs text-muted">{input.description}</p>
                    {installation.configuredKeys.includes(input.key) ? (
                      <Button
                        variant="ghost"
                        className="h-6 min-h-0 shrink-0 px-1 text-xs"
                        isDisabled={busy}
                        onPress={() =>
                          setValues((previous) => ({
                            ...previous,
                            [input.key]: null,
                          }))
                        }
                      >
                        清除
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy || !dirty}
                onPress={() => void save()}
              >
                保存配置
              </Button>
            </div>
          ) : null}
          {revision !== installation.revision ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                插件已在其他操作中更新。保存前请重新载入配置。
              </p>
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy}
                onPress={() => {
                  if (
                    !dirty ||
                    window.confirm('放弃未保存输入并载入最新配置？')
                  ) {
                    setValues({})
                    setRevision(installation.revision)
                  }
                }}
              >
                载入最新配置
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-divider pt-4">
            {actionError}
            <Button
              variant="primary"
              className="h-9 min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
              isDisabled={busy || !!installation.error}
              onPress={() => void save(!installation.enabled)}
            >
              {installation.enabled
                ? '停用插件'
                : dirty
                  ? '保存并启用'
                  : '启用插件'}
            </Button>
            {installation.manifest.hooks.length ? (
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={
                  busy || dirty || !installation.enabled || !!installation.error
                }
                onPress={() => void trustHooks(!installation.hooksTrusted)}
              >
                {installation.hooksTrusted
                  ? '停止命令 Hooks'
                  : '信任当前版本的命令 Hooks'}
              </Button>
            ) : null}
            {installation.enabled &&
            installation.servers.some(
              (server) =>
                server.status === MCP_CONNECTION_STATUS.ERROR ||
                server.status === MCP_CONNECTION_STATUS.DISCONNECTED,
            ) ? (
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy || dirty}
                onPress={() => void save(true)}
              >
                重试连接
              </Button>
            ) : null}
            {directSource ? (
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy || dirty}
                onPress={() =>
                  void state.prepareDirect({
                    url: directSource.url,
                    ref: directSource.ref,
                    path: directSource.path,
                  })
                }
              >
                检查更新
              </Button>
            ) : installation.latestVersion &&
              installation.latestVersion !== installation.manifest.version ? (
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy || dirty}
                onPress={() => void state.prepare(installation.entryId)}
              >
                更新至 v{installation.latestVersion}
              </Button>
            ) : null}
            {installation.previousVersion ? (
              <Button
                variant="outline"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={busy || dirty}
                onPress={() => setConfirmRollback(true)}
              >
                回退版本
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="text-danger"
              isDisabled={busy}
              onPress={() => setConfirmDelete(true)}
            >
              卸载插件
            </Button>
          </div>
          {confirmRollback ? (
            <div className="rounded-xl bg-surface-secondary p-3 text-sm">
              <p>
                回退到 v{installation.previousVersion}{' '}
                并停用插件？此操作不会撤销已经发生的外部操作。
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                  isDisabled={busy}
                  onPress={() => setConfirmRollback(false)}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  className="h-9 min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
                  isDisabled={busy}
                  onPress={() =>
                    void state
                      .mutate((signal) =>
                        pluginApi.rollback(signal, installation.id, revision!),
                      )
                      .then((result) => {
                        if (result) onBack()
                      })
                  }
                >
                  确认回退
                </Button>
              </div>
            </div>
          ) : null}
          {confirmDelete ? (
            <div className="rounded-xl bg-surface-secondary p-3 text-sm">
              <p>
                卸载「{installation.manifest.displayName}
                」及其版本、配置和凭据？独立 Skills 与手动 MCP 不受影响。
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                  isDisabled={busy}
                  onPress={() => setConfirmDelete(false)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  isDisabled={busy}
                  onPress={() =>
                    void state
                      .mutate((signal) =>
                        pluginApi.remove(signal, installation.id, revision!),
                      )
                      .then((result) => {
                        if (result) onBack()
                      })
                  }
                >
                  确认卸载
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
