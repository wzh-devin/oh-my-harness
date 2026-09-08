import type {
  McpOAuthStatus,
  McpAuthStatus,
  McpRuntimeConnectionStatus,
  McpTransport,
  PluginCompatibilityStatus,
  PluginImportKind,
  PluginImportStatus,
} from '@oh-my-harness/shared'

export type CompatibilityVo = {
  capability: string
  status: PluginCompatibilityStatus
  message: string
}
export interface PluginVo {
  id: string
  name: string
  description: string
  enabled: boolean
  blocked: boolean
  version?: string
  revision: string
  format: string
  source: string
  canRollback: boolean
  skills: number
  commands: number
  compatibility: CompatibilityVo[]
}
export interface MarketplaceVo {
  id: string
  name: string
  displayName: string
  source: string
  format: string
  entries: {
    id: string
    name: string
    description: string
    available: boolean
    installationId?: string
    compatibility: CompatibilityVo[]
  }[]
}
export interface ConnectionVo {
  id: string
  installationId: string
  serverName: string
  transport: McpTransport
  endpoint?: string
  allowed: boolean
  requiredKeys: string[]
  configuredKeys: string[]
  authStatus: McpAuthStatus
  connectionStatus: McpRuntimeConnectionStatus
  message?: string
}
export interface ImportVo {
  id: string
  status: PluginImportStatus
  error?: string
  candidates: {
    key: string
    root: string
    kind: PluginImportKind
    format: string
  }[]
}
export interface ImportPreviewVo {
  name: string
  description?: string
  format: string
  skills?: number
  commands?: number
  blocked?: boolean
  compatibility?: CompatibilityVo[]
  entries?: {
    name: string
    available: boolean
    compatibility: CompatibilityVo[]
  }[]
  servers?: { name: string; transport: string }[]
}
export interface PluginOAuthVo {
  id: string
  connectionId: string
  status: McpOAuthStatus
  authorizationUrl?: string
  expiresAt: number
}

export async function pluginRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const form = options.body instanceof FormData
  const response = await fetch(`/api/${path}`, {
    method: options.method ?? 'GET',
    signal: options.signal,
    ...(options.body === undefined
      ? {}
      : {
          headers: form ? undefined : { 'Content-Type': 'application/json' },
          body: form
            ? (options.body as FormData)
            : JSON.stringify(options.body),
        }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => undefined)
    throw new Error(data?.message ?? `插件请求失败（${response.status}）`)
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>)
}
