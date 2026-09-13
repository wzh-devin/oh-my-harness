import type {
  McpConfigVo,
  McpListVo,
  McpPreviewVo,
  McpToolVo,
} from '../types/mcp-vo.ts'

/** 设置请求只传输到当前宿主；凭据不写入 Web 存储，响应错误不回显输入。 */
async function request<T>(
  path: string,
  signal: AbortSignal,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/mcp/${path}`, {
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
  const value = await response.json()
  if (!response.ok)
    throw new Error(
      typeof value.message === 'string'
        ? value.message
        : 'MCP 请求失败，请重试。',
    )
  return value as T
}

export const mcpApi = {
  list: (signal: AbortSignal) => request<McpListVo>('servers', signal),
  config: (signal: AbortSignal) => request<McpConfigVo>('config', signal),
  secret: (id: string, key: string, revision: number, signal: AbortSignal) =>
    request<{ value: string }>(
      `servers/${encodeURIComponent(id)}/secret`,
      signal,
      'POST',
      { key, revision },
    ),
  tools: (id: string, signal: AbortSignal) =>
    request<McpToolVo[]>(`servers/${encodeURIComponent(id)}/tools`, signal),
  preview: (source: string, revision: number, signal: AbortSignal) =>
    request<McpPreviewVo>('config/preview', signal, 'POST', {
      source,
      revision,
    }),
  replace: (
    source: string,
    revision: number,
    confirmedDeletedIds: string[],
    signal: AbortSignal,
  ) =>
    request<McpListVo>('config', signal, 'PUT', {
      source,
      revision,
      confirmedDeletedIds,
    }),
  save: (
    name: string,
    config: unknown,
    revision: number,
    signal: AbortSignal,
    id?: string,
  ) =>
    request<McpListVo>(
      id ? `servers/${encodeURIComponent(id)}` : 'servers',
      signal,
      id ? 'PATCH' : 'POST',
      { name, config, revision },
    ),
  remove: (id: string, revision: number, signal: AbortSignal) =>
    request<McpListVo>(`servers/${encodeURIComponent(id)}`, signal, 'DELETE', {
      revision,
    }),
  reconnect: (id: string, revision: number, signal: AbortSignal) =>
    request<McpListVo>(
      `servers/${encodeURIComponent(id)}/reconnect`,
      signal,
      'POST',
      { revision },
    ),
  test: (name: string, config: unknown, signal: AbortSignal, id?: string) =>
    request<{ toolCount: number }>('test', signal, 'POST', {
      name,
      config,
      ...(id ? { id } : {}),
    }),
}
