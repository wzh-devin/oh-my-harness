import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginSettings } from '../../providers/contexts/plugin-settings-context.ts'
import {
  pluginRequest,
  type PluginVo,
  type MarketplaceVo,
  type ConnectionVo,
} from '../api/plugin-api.ts'

/** 读取真实插件目录并串行提交管理操作，丢弃过期列表响应。 */
export const usePluginCatalog = () => {
  const { refreshCapabilities } = usePluginSettings()
  const [plugins, setPlugins] = useState<PluginVo[]>([])
  const [markets, setMarkets] = useState<MarketplaceVo[]>([])
  const [connections, setConnections] = useState<ConnectionVo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [replacement, setReplacement] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [installingEntry, setInstallingEntry] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const operation = useRef(false)
  const reload = useCallback(() => {
    setRefresh((value) => value + 1)
    refreshCapabilities()
  }, [refreshCapabilities])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      pluginRequest<{ installations: PluginVo[] }>('plugin-installations', {
        signal: controller.signal,
      }),
      pluginRequest<{ marketplaces: MarketplaceVo[] }>('plugin-marketplaces', {
        signal: controller.signal,
      }),
      pluginRequest<{ connections: ConnectionVo[] }>('plugin-connections', {
        signal: controller.signal,
      }),
    ])
      .then(([p, m, c]) => {
        if (controller.signal.aborted) return
        setPlugins(p.installations)
        setMarkets(m.marketplaces)
        setConnections(c.connections)
        setError('')
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError((error as Error).message)
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [refresh])
  const act = async <T>(path: string, method: string, body?: unknown) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await pluginRequest<T>(path, { method, body })
      reload()
      return result
    } catch (error) {
      setError((error as Error).message)
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  /** 立即显示安装中和完成态，最终以服务端幂等安装结果为准。 */
  const installEntry = async (
    marketplaceId: string,
    entry: MarketplaceVo['entries'][number],
  ) => {
    if (operation.current || entry.installationId) return
    setInstallingEntry(`${marketplaceId}:${entry.id}`)
    const installed = await act<PluginVo>('plugin-installations', 'POST', {
      marketplaceId,
      entryId: entry.id,
    })
    if (installed) {
      setMarkets((current) =>
        current.map((market) =>
          market.id === marketplaceId
            ? {
                ...market,
                entries: market.entries.map((item) =>
                  item.id === entry.id
                    ? { ...item, installationId: installed.id }
                    : item,
                ),
              }
            : market,
        ),
      )
      setPlugins((current) => [
        ...current.filter((item) => item.id !== installed.id),
        installed,
      ])
      setMessage(
        `${installed.name} 已安装${installed.enabled ? '，可在聊天中选用。' : '，请到“插件”页启用。'}`,
      )
    }
    setInstallingEntry(null)
  }
  return {
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
  }
}
