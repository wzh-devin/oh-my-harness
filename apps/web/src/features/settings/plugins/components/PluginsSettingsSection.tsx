import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, TextField } from '@heroui/react'
import { Package, Store } from 'lucide-react'
import {
  PLUGIN_FORMAT,
  PLUGIN_INSTALLATION_SOURCE_KIND,
  PLUGIN_SOURCE_KIND,
} from '@oh-my-harness/shared'
import { useCapabilitySettings } from '../../providers/contexts/capability-settings-context.ts'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import {
  SettingsBackButton,
  SettingsSubpageHeader,
} from '../../shared/components/SettingsBackNavigation.tsx'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import { usePluginSettings } from '../hooks/use-plugin-settings.ts'
import { pluginApi } from '../api/plugin-api.ts'
import { PluginDetail } from './PluginDetail.tsx'
import { PluginGitSourceForm } from './PluginGitSourceForm.tsx'
import type { PluginEntryVo } from '../types/plugin-vo.ts'

function CatalogIcon({
  iconId,
  iconDarkId,
  market = false,
}: {
  iconId?: string
  iconDarkId?: string
  market?: boolean
}) {
  const [failedKey, setFailedKey] = useState('')
  const iconKey = `${iconId}:${iconDarkId}`
  if (!iconId || failedKey === iconKey)
    return market ? (
      <Store aria-hidden className="size-4 text-muted" />
    ) : (
      <Package aria-hidden className="size-4 text-muted" />
    )
  return (
    <span className="block size-6 shrink-0">
      <img
        src={pluginApi.iconUrl(iconId)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className={`size-6 object-contain ${iconDarkId ? 'dark:hidden' : ''}`}
        onError={() => setFailedKey(iconKey)}
      />
      {iconDarkId ? (
        <img
          src={pluginApi.iconUrl(iconDarkId)}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="hidden size-6 object-contain dark:block"
          onError={() => setFailedKey(iconKey)}
        />
      ) : null}
    </span>
  )
}

/** 以市场为首页，沿用设置卡片进入市场插件、已安装和直接安装。 */
export function PluginsSettingsSection({
  initialPluginId,
  onBusyChange,
  onDirtyChange,
}: {
  initialPluginId?: string
  onBusyChange(busy: boolean): void
  onDirtyChange(dirty: boolean): void
}) {
  const { refreshCapabilities } = useCapabilitySettings()
  const [selectedMarketId, setSelectedMarketId] = useState<string>()
  const [showInstalled, setShowInstalled] = useState(!!initialPluginId)
  const [adding, setAdding] = useState<'plugin' | 'market'>()
  const [directDetail, setDirectDetail] = useState(false)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [entry, setEntry] = useState<PluginEntryVo>()
  const [installationId, setInstallationId] = useState(initialPluginId)
  const [notice, setNotice] = useState('')
  const dirty = useRef(false)
  const state = usePluginSettings(
    query,
    '',
    offset,
    selectedMarketId ?? '',
    refreshCapabilities,
  )
  const installations = state.list?.installations ?? []
  const markets = state.catalog?.markets ?? []
  const selectedMarket = markets.find((item) => item.id === selectedMarketId)
  const selected = state.list?.installations.find((item) =>
    installationId ? item.id === installationId : item.entryId === entry?.id,
  )
  const opened = !!entry || !!installationId || directDetail
  const markDirty = useCallback(
    (value: boolean) => {
      dirty.current = value
      onDirtyChange(value)
    },
    [onDirtyChange],
  )
  useEffect(() => {
    onBusyChange(state.busy)
    return () => onBusyChange(false)
  }, [state.busy, onBusyChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const canLeave = () =>
    !state.busy && (!dirty.current || window.confirm('放弃未保存的插件设置？'))
  const closeForm = () => {
    state.abortRequest()
    markDirty(false)
    setAdding(undefined)
    state.setError('')
  }
  /** 返回时取消未提交预览；市场插件回到原市场，直接安装回到已安装。 */
  const closeDetail = async () => {
    if (!canLeave() || !(await state.cancel())) return
    markDirty(false)
    const installedPage = showInstalled || directDetail
    setEntry(undefined)
    setInstallationId(undefined)
    setDirectDetail(false)
    setShowInstalled(installedPage)
    state.setError('')
  }
  const home = () => {
    if (!canLeave()) return
    markDirty(false)
    setAdding(undefined)
    setShowInstalled(false)
    setSelectedMarketId(undefined)
    setQuery('')
    setOffset(0)
    state.setError('')
  }
  const addMarket = async (source: {
    url: string
    ref: string
    path: string
  }) => {
    const result = await state.run((signal) =>
      pluginApi.addMarket(signal, source),
    )
    if (!result) return
    markDirty(false)
    setAdding(undefined)
    setNotice('插件市场已添加。')
    state.retryCatalog()
  }
  const installDirect = async (source: {
    url: string
    ref: string
    path: string
  }) => {
    const result = await state.prepareDirect(source)
    if (!result) return
    markDirty(false)
    setAdding(undefined)
    setDirectDetail(true)
  }
  const changeMarket = async (id: string, remove = false) => {
    if (remove && !window.confirm('移除此插件市场？已安装的插件会保留。'))
      return
    const result = await state.run((signal) =>
      remove
        ? pluginApi.removeMarket(signal, id)
        : pluginApi.refreshMarket(signal, id),
    )
    if (result) {
      setNotice(
        remove ? '插件市场已移除，已安装插件已保留。' : '插件市场已刷新。',
      )
      if (remove && selectedMarketId === id) home()
      state.retryCatalog()
    }
  }

  const installedList = (
    <>
      <SettingsSubpageHeader label="返回插件市场" onBack={home}>
        <h2 className="text-base leading-6 font-medium text-foreground">
          已安装插件
        </h2>
      </SettingsSubpageHeader>
      {!state.list ? (
        <p role="status" className="text-sm text-muted">
          正在读取已安装插件…
        </p>
      ) : null}
      {state.list && installations.length === 0 ? (
        <p className="text-sm text-muted">尚未安装插件。</p>
      ) : null}
      {installations.map((item) => (
        <SettingsItemCard
          key={item.id}
          title={
            <>
              <span className="truncate">{item.manifest.displayName}</span>
              {item.source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT ? (
                <span className="shrink-0 text-xs font-normal text-muted">
                  直接安装
                </span>
              ) : null}
              <span
                className={`shrink-0 text-xs font-normal ${item.error ? 'text-danger' : item.enabled ? 'text-success' : 'text-muted'}`}
              >
                {item.error
                  ? '异常'
                  : item.enabled
                    ? '已启用'
                    : item.missingKeys.length
                      ? '待配置'
                      : '未启用'}
              </span>
            </>
          }
          description={item.manifest.description}
          icon={<Package aria-hidden className="size-4 text-muted" />}
          openLabel={`管理插件 ${item.manifest.displayName}`}
          isDisabled={state.busy}
          onOpen={() => setInstallationId(item.id)}
          actions={
            <Button
              className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
              variant="outline"
              isDisabled={state.busy}
              onPress={() => setInstallationId(item.id)}
            >
              管理
            </Button>
          }
        />
      ))}
    </>
  )

  const marketPlugins = (
    <>
      <SettingsSubpageHeader label="返回插件市场" onBack={home}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-base leading-6 font-medium text-foreground">
            {selectedMarket?.builtIn ? '官方市场' : selectedMarket?.name}
          </h2>
          {selectedMarket && selectedMarket.format !== PLUGIN_FORMAT.NATIVE ? (
            <span className="shrink-0 text-xs text-muted">
              {selectedMarket?.format === PLUGIN_FORMAT.CODEX
                ? 'Codex 格式'
                : 'Claude Code 格式'}
            </span>
          ) : null}
          {selectedMarket ? (
            <Button
              className="h-8 shrink-0 rounded-full px-3 text-sm"
              variant="outline"
              isDisabled={state.busy}
              onPress={() => void changeMarket(selectedMarket.id)}
            >
              刷新
            </Button>
          ) : null}
        </div>
      </SettingsSubpageHeader>
      <TextField aria-label="搜索插件" className="w-full" value={query}>
        <Input
          autoFocus
          variant="secondary"
          placeholder="搜索这个市场中的插件"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setOffset(0)
          }}
        />
      </TextField>
      {state.loading ? (
        <p role="status" className="text-sm text-muted">
          正在读取插件…
        </p>
      ) : null}
      {state.catalog?.entries.map((item) => {
        const installed = installations.find(
          (value) => value.entryId === item.id,
        )
        return (
          <SettingsItemCard
            key={item.id}
            title={<span className="truncate">{item.displayName}</span>}
            description={
              item.source.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED
                ? (item.source.reason ?? item.description)
                : item.description
            }
            icon={
              <CatalogIcon iconId={item.iconId} iconDarkId={item.iconDarkId} />
            }
            openLabel={`查看插件 ${item.displayName}`}
            onOpen={() => setEntry(item)}
            actions={
              <Button
                className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                variant="outline"
                isDisabled={
                  state.busy ||
                  item.source.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED
                }
                onPress={() => {
                  setEntry(item)
                  if (!installed) void state.prepare(item.id)
                }}
              >
                {installed ? '管理' : '安装'}
              </Button>
            }
          />
        )
      })}
      {!state.loading && state.catalog?.total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">没有匹配的插件</p>
      ) : null}
      {state.catalog && state.catalog.total > 50 ? (
        <div className="flex items-center justify-between text-xs text-muted">
          <Button
            className="h-7 rounded-full text-xs"
            variant="outline"
            isDisabled={offset === 0 || state.loading}
            onPress={() => setOffset((value) => Math.max(0, value - 50))}
          >
            上一页
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + 50, state.catalog.total)} /{' '}
            {state.catalog.total}
          </span>
          <Button
            className="h-7 rounded-full text-xs"
            variant="outline"
            isDisabled={offset + 50 >= state.catalog.total || state.loading}
            onPress={() => setOffset((value) => value + 50)}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </>
  )

  return (
    <section className="mx-auto max-w-2xl" aria-label="插件市场设置">
      <div className="flex flex-col gap-3">
        {opened ? (
          selected || entry || directDetail ? (
            <SettingsEditorCard>
              <PluginDetail
                key={selected?.id ?? entry?.id ?? state.operation?.id}
                entry={entry}
                installation={selected}
                state={state}
                backLabel={
                  showInstalled || directDetail
                    ? '返回已安装插件'
                    : '返回市场插件'
                }
                onBack={() => void closeDetail()}
                onDirtyChange={markDirty}
              />
            </SettingsEditorCard>
          ) : (
            <>
              <SettingsBackButton
                label="返回已安装插件"
                onBack={() => void closeDetail()}
              />
              <p role="status" className="text-sm text-muted">
                {state.list ? '插件不存在或已卸载。' : '正在读取插件…'}
              </p>
            </>
          )
        ) : showInstalled ? (
          installedList
        ) : selectedMarketId ? (
          marketPlugins
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base leading-6 font-medium text-foreground">
                插件市场
              </h2>
              <Button
                className="h-8 rounded-full px-3 text-sm"
                variant="outline"
                isDisabled={state.busy}
                onPress={() => {
                  setShowInstalled(true)
                  setNotice('')
                }}
              >
                已安装插件（{state.list ? installations.length : '…'}）
              </Button>
            </div>
            <p className="text-sm text-muted">
              选择一个市场，查看并安装其中提供的插件。
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <SettingsAddButton
                label="安装单个插件"
                isDisabled={state.busy || !!adding}
                onPress={() => {
                  setAdding('plugin')
                  setNotice('')
                  state.setError('')
                }}
              />
              <SettingsAddButton
                label="添加插件市场"
                isDisabled={state.busy || !!adding}
                onPress={() => {
                  setAdding('market')
                  setNotice('')
                  state.setError('')
                }}
              />
            </div>
            {adding ? (
              <PluginGitSourceForm
                kind={adding}
                busy={state.busy}
                error={state.error}
                onSubmit={adding === 'market' ? addMarket : installDirect}
                onCancel={closeForm}
                onDirtyChange={markDirty}
              />
            ) : null}
            <div className="mt-2 flex flex-col gap-3">
              {markets.map((item) => (
                <SettingsItemCard
                  key={item.id}
                  title={
                    <>
                      <span className="truncate">
                        {item.builtIn ? '官方市场' : item.name}
                      </span>
                      {item.format !== PLUGIN_FORMAT.NATIVE ? (
                        <span className="shrink-0 text-xs font-normal text-muted">
                          {item.format === PLUGIN_FORMAT.CODEX
                            ? 'Codex 格式'
                            : 'Claude Code 格式'}
                        </span>
                      ) : null}
                    </>
                  }
                  description={
                    item.error ??
                    (item.builtIn
                      ? `${item.pluginCount} 个插件 · 随应用提供`
                      : `${item.pluginCount} 个插件 · ${item.url}`)
                  }
                  icon={
                    <CatalogIcon
                      iconId={item.iconId}
                      iconDarkId={item.iconDarkId}
                      market
                    />
                  }
                  openLabel={`查看市场 ${item.builtIn ? '官方市场' : item.name}`}
                  isDisabled={state.busy || !!adding}
                  onOpen={() => {
                    setSelectedMarketId(item.id)
                    setQuery('')
                    setOffset(0)
                    setNotice('')
                  }}
                  actions={
                    <>
                      <Button
                        className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                        variant="outline"
                        isDisabled={state.busy || !!adding}
                        onPress={() => {
                          setSelectedMarketId(item.id)
                          setQuery('')
                          setOffset(0)
                        }}
                      >
                        查看
                      </Button>
                      {!item.builtIn ? (
                        <Button
                          aria-label={`移除市场 ${item.name}`}
                          className="h-7 min-h-0 rounded-full !px-2.5 !text-xs text-danger"
                          variant="outline"
                          isDisabled={state.busy || !!adding}
                          onPress={() => void changeMarket(item.id, true)}
                        >
                          移除
                        </Button>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}
        {notice && !opened ? (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        ) : null}
        {!adding && !opened && state.error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state.catalog?.error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {state.catalog.error}
          </p>
        ) : null}
        {!state.catalog && !state.loading ? (
          <Button
            className="h-8 w-fit rounded-full text-sm"
            variant="outline"
            onPress={state.retryCatalog}
          >
            重新读取市场
          </Button>
        ) : null}
      </div>
    </section>
  )
}
