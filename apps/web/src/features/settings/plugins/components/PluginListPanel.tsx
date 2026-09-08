import { Fragment } from 'react'
import { Puzzle, RefreshCw, Store } from 'lucide-react'
import { Button, Input, TextField } from '@heroui/react'
import {
  PLUGIN_IMPORT_KIND,
  PLUGIN_SETTINGS_TAB,
  type PluginSettingsTab,
} from '@oh-my-harness/shared'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import { PluginMarketplaceDetail } from './PluginMarketplaceDetail.tsx'
import { PluginImportForm } from './PluginImportForm.tsx'
import { PluginConnection } from './PluginConnection.tsx'
import { usePluginCatalog } from '../hooks/use-plugin-catalog.ts'

/** 沿用设置列表和内联编辑器，展示服务端安装事实及管理反馈。 */
export function PluginListPanel({
  searchQuery,
  onSearchQueryChange,
  mode = PLUGIN_SETTINGS_TAB.PLUGINS,
  initialSelectedId,
}: {
  searchQuery: string
  onSearchQueryChange(query: string): void
  mode?: Exclude<PluginSettingsTab, typeof PLUGIN_SETTINGS_TAB.SKILLS>
  initialSelectedId?: string
}) {
  const {
    plugins,
    markets,
    connections,
    selected,
    setSelected,
    importing,
    setImporting,
    replacement,
    setReplacement,
    busy,
    loading,
    error,
    message,
    installingEntry,
    installEntry,
    reload,
    act,
  } = usePluginCatalog(initialSelectedId)
  const activeMarket =
    mode === PLUGIN_SETTINGS_TAB.MARKETPLACES
      ? markets.find((market) => market.id === selected)
      : undefined
  const openMarket = (id: string | null) => {
    setSelected(id)
    onSearchQueryChange('')
    setImporting(false)
  }
  const query = searchQuery.trim().toLowerCase()
  const visiblePlugins = plugins.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query),
  )
  const visibleMarkets = markets.filter(
    (item) =>
      `${item.name} ${item.displayName}`.toLowerCase().includes(query) ||
      item.entries.some((entry) =>
        `${entry.name} ${entry.description}`.toLowerCase().includes(query),
      ),
  )
  const replace = (id: string) => {
    setReplacement(id)
    setImporting(true)
  }
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={
        mode === PLUGIN_SETTINGS_TAB.PLUGINS ? '已安装插件' : '插件市场'
      }
    >
      <div className="flex items-center gap-2">
        <TextField
          className="min-w-0 flex-1"
          aria-label="搜索插件或市场"
          value={searchQuery}
          onChange={onSearchQueryChange}
        >
          <Input
            placeholder={
              activeMarket
                ? '搜索此市场的插件'
                : mode === PLUGIN_SETTINGS_TAB.PLUGINS
                  ? '搜索插件'
                  : '搜索市场或插件'
            }
            variant="secondary"
          />
        </TextField>
        <Button
          aria-label="刷新列表"
          className="h-8 min-h-0 rounded-full px-3 text-xs"
          variant="outline"
          isDisabled={busy}
          onPress={reload}
        >
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="py-6 text-center text-sm text-muted">
          正在读取插件…
        </p>
      ) : null}
      {!loading &&
      !activeMarket &&
      query &&
      !(mode === PLUGIN_SETTINGS_TAB.PLUGINS ? visiblePlugins : visibleMarkets)
        .length ? (
        <p role="status" className="py-6 text-center text-sm text-muted">
          没有匹配的结果。
        </p>
      ) : null}
      {importing ? (
        <PluginImportForm
          key={replacement ?? 'new'}
          replaceId={replacement}
          replaceKind={
            mode === PLUGIN_SETTINGS_TAB.PLUGINS
              ? PLUGIN_IMPORT_KIND.PLUGIN
              : PLUGIN_IMPORT_KIND.MARKETPLACE
          }
          onClose={() => setImporting(false)}
          onInstalled={() => {
            setImporting(false)
            setReplacement(undefined)
            reload()
          }}
        />
      ) : null}
      {mode === PLUGIN_SETTINGS_TAB.PLUGINS ? (
        <>
          {!loading && !plugins.length ? (
            <p className="py-6 text-center text-sm text-muted">
              尚未安装插件。可以直接导入，或从市场安装。
            </p>
          ) : null}
          {visiblePlugins.map((item) => (
            <Fragment key={item.id}>
              <SettingsItemCard
                icon={<Puzzle className="size-4 text-muted" />}
                title={
                  <>
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 text-xs font-normal text-muted">
                      {item.version ?? ''}
                    </span>
                  </>
                }
                description={
                  item.description ||
                  (item.enabled ? '已启用，可在聊天中选用' : '已安装，待启用')
                }
                openLabel={`查看插件 ${item.name}`}
                onOpen={() =>
                  setSelected(selected === item.id ? null : item.id)
                }
                actions={
                  <Button
                    className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                    variant="outline"
                    isDisabled={busy || item.blocked}
                    onPress={() =>
                      void act(`plugin-installations/${item.id}`, 'PATCH', {
                        enabled: !item.enabled,
                      })
                    }
                  >
                    {item.enabled ? '禁用' : '启用'}
                  </Button>
                }
              />
              {selected === item.id ? (
                <SettingsEditorCard>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {item.name}
                    </h3>
                    <p className="text-xs text-muted">{item.description}</p>
                    <p className="break-all text-xs text-muted">
                      {item.source} · {item.format} ·{' '}
                      {item.blocked
                        ? '存在未支持的依赖'
                        : item.enabled
                          ? '已启用'
                          : '未启用'}
                    </p>
                    {item.compatibility.map((issue, index) => (
                      <p key={index} className="text-xs text-muted">
                        {issue.message}
                      </p>
                    ))}
                    {connections
                      .filter(
                        (connection) => connection.installationId === item.id,
                      )
                      .map((connection) => (
                        <PluginConnection
                          key={connection.id}
                          connection={connection}
                          onChanged={reload}
                        />
                      ))}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        className="h-8 min-h-0 rounded-full px-3 text-xs"
                        variant="outline"
                        isDisabled={busy}
                        onPress={() =>
                          item.source.startsWith('https:')
                            ? void act(
                                `plugin-installations/${item.id}/update`,
                                'POST',
                              )
                            : replace(item.id)
                        }
                      >
                        更新
                      </Button>
                      <Button
                        className="h-8 min-h-0 rounded-full px-3 text-xs"
                        variant="outline"
                        isDisabled={busy || !item.canRollback}
                        onPress={() =>
                          void act(
                            `plugin-installations/${item.id}/rollback`,
                            'POST',
                          )
                        }
                      >
                        回滚
                      </Button>
                      <Button
                        className="h-8 min-h-0 rounded-full px-3 text-xs text-danger"
                        variant="outline"
                        isDisabled={busy}
                        onPress={() => {
                          if (
                            window.confirm(
                              `卸载 ${item.name} 并清除其本地连接凭据？`,
                            )
                          )
                            void act(
                              `plugin-installations/${item.id}`,
                              'DELETE',
                            )
                        }}
                      >
                        卸载
                      </Button>
                    </div>
                  </div>
                </SettingsEditorCard>
              ) : null}
            </Fragment>
          ))}
        </>
      ) : (
        <>
          {!loading && !markets.length ? (
            <p className="py-6 text-center text-sm text-muted">
              尚未添加市场。添加市场不会自动安装插件。
            </p>
          ) : null}
          {activeMarket ? (
            <PluginMarketplaceDetail
              market={activeMarket}
              query={query}
              busy={busy}
              installingEntry={installingEntry}
              onBack={() => openMarket(null)}
              onInstall={(entry) => void installEntry(activeMarket.id, entry)}
              onRefresh={() =>
                activeMarket.source.startsWith('https:')
                  ? void act(
                      `plugin-marketplaces/${activeMarket.id}/refresh`,
                      'POST',
                    )
                  : replace(activeMarket.id)
              }
              onRemove={() => {
                if (window.confirm('移除此市场？已安装插件会保留。'))
                  void act(`plugin-marketplaces/${activeMarket.id}`, 'DELETE')
              }}
            />
          ) : (
            visibleMarkets.map((market) => (
              <SettingsItemCard
                key={market.id}
                icon={<Store className="size-4 text-muted" />}
                title={market.displayName}
                description={`${market.entries.length} 个插件 · ${market.source}`}
                openLabel={`浏览市场 ${market.displayName}`}
                onOpen={() => openMarket(market.id)}
                actions={
                  <Button
                    className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                    variant="outline"
                    onPress={() => openMarket(market.id)}
                  >
                    浏览
                  </Button>
                }
              />
            ))
          )}
        </>
      )}
      {!importing && !activeMarket ? (
        <SettingsAddButton
          label={
            mode === PLUGIN_SETTINGS_TAB.PLUGINS ? '导入插件' : '添加插件市场'
          }
          onPress={() => {
            setReplacement(undefined)
            setImporting(true)
          }}
        />
      ) : null}
    </section>
  )
}
