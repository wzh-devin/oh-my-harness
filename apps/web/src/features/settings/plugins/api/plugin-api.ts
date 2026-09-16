import type {
  PluginCatalogVo,
  PluginListVo,
  PluginOperationVo,
} from '../types/plugin-vo.ts'

/** 插件请求仅到当前服务端，凭据不写入浏览器存储或请求 URL。 */
const request = async <T>(
  path: string,
  signal: AbortSignal,
  method = 'GET',
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`/api/plugins/${path}`, {
    method,
    signal,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  const value =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined)
  if (!response.ok)
    throw new Error(
      typeof value?.message === 'string'
        ? value.message
        : '插件请求失败，请重试。',
    )
  return value as T
}
export const pluginApi = {
  iconUrl: (id: string) => `/api/plugins/icons/${encodeURIComponent(id)}`,
  catalog: (
    signal: AbortSignal,
    query: string,
    category: string,
    offset: number,
    market: string,
  ) =>
    request<PluginCatalogVo>(
      `catalog?${new URLSearchParams({ q: query, category, market, offset: String(offset) })}`,
      signal,
    ),
  refresh: (signal: AbortSignal) =>
    request<PluginCatalogVo>('catalog/refresh', signal, 'POST', {}),
  addMarket: (
    signal: AbortSignal,
    source: { url: string; ref: string; path: string },
  ) => request<PluginCatalogVo>('markets', signal, 'POST', source),
  refreshMarket: (signal: AbortSignal, id: string) =>
    request<PluginCatalogVo>(
      `markets/${encodeURIComponent(id)}/refresh`,
      signal,
      'POST',
      {},
    ),
  removeMarket: (signal: AbortSignal, id: string) =>
    request<PluginCatalogVo>(
      `markets/${encodeURIComponent(id)}`,
      signal,
      'DELETE',
    ),
  list: (signal: AbortSignal) => request<PluginListVo>('installations', signal),
  prepare: (signal: AbortSignal, entryId: string) =>
    request<PluginOperationVo>('operations', signal, 'POST', { entryId }),
  prepareDirect: (
    signal: AbortSignal,
    source: { url: string; ref: string; path: string },
  ) => request<PluginOperationVo>('operations/direct', signal, 'POST', source),
  operation: (signal: AbortSignal, id: string) =>
    request<PluginOperationVo>(`operations/${encodeURIComponent(id)}`, signal),
  commit: (signal: AbortSignal, id: string) =>
    request<PluginListVo>(
      `operations/${encodeURIComponent(id)}/commit`,
      signal,
      'POST',
      {},
    ),
  cancel: (signal: AbortSignal, id: string) =>
    request<void>(`operations/${encodeURIComponent(id)}`, signal, 'DELETE'),
  update: (
    signal: AbortSignal,
    id: string,
    revision: number,
    patch: { enabled?: boolean; values?: Record<string, string | null> },
  ) =>
    request<PluginListVo>(
      `installations/${encodeURIComponent(id)}`,
      signal,
      'PATCH',
      { revision, ...patch },
    ),
  rollback: (signal: AbortSignal, id: string, revision: number) =>
    request<PluginListVo>(
      `installations/${encodeURIComponent(id)}/rollback`,
      signal,
      'POST',
      { revision },
    ),
  trustHooks: (
    signal: AbortSignal,
    id: string,
    revision: number,
    trusted: boolean,
  ) =>
    request<PluginListVo>(
      `installations/${encodeURIComponent(id)}/hooks/trust`,
      signal,
      'POST',
      { revision, trusted },
    ),
  remove: (signal: AbortSignal, id: string, revision: number) =>
    request<PluginListVo>(
      `installations/${encodeURIComponent(id)}`,
      signal,
      'DELETE',
      { revision },
    ),
}
