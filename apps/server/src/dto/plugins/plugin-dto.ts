import type { McpAuthPolicy } from '@oh-my-harness/shared'
import type { McpAuthDto } from '../mcp/mcp-dto.ts'
import { PLUGIN_INSTALLATION_SOURCE_KIND } from '@oh-my-harness/shared'
import type {
  PluginInputTarget,
  PluginFormat,
  PluginSourceKind,
  PluginOperationStatus,
  McpConnectionStatus,
} from '@oh-my-harness/shared'

export interface PluginManifestDto {
  schemaVersion: 1
  format: PluginFormat
  name: string
  displayName: string
  version: string
  description: string
  author: string
  license: string
  examples: string[]
  requirements: string
  skills: string[]
  mcpServers: Record<
    string,
    { url?: string; command?: string; args?: string[] }
  >
  inputs: {
    key: string
    label: string
    description: string
    required: boolean
    secret: boolean
    server: string
    target: PluginInputTarget
    name: string
    prefix: string
  }[]
  hooks: {
    event: 'SessionStart' | 'UserPromptSubmit'
    matcher: string
    command: string
    timeout: number
  }[]
  unavailable: string[]
}
export interface PluginEntryDto {
  authentication?: McpAuthPolicy
  id: string
  name: string
  displayName: string
  description: string
  category: string
  version?: string
  iconId?: string
  iconDarkId?: string
  format: PluginFormat
  market: string
  source: {
    kind: PluginSourceKind
    path: string
    url?: string
    commit?: string
    ref?: string
    hash?: string
    reason?: string
  }
}
export interface PluginMarketDto {
  id: string
  name: string
  builtIn: boolean
  format: PluginFormat
  url?: string
  ref?: string
  path?: string
  commit?: string
  updatedAt: string
  iconId?: string
  iconDarkId?: string
  pluginCount: number
  error?: string
}
export interface PluginCatalogDto {
  markets: PluginMarketDto[]
  entries: PluginEntryDto[]
  total: number
  categories: string[]
  updatedAt: string
  error?: string
}
export interface PluginInstallationDto {
  id: string
  entryId: string
  source:
    | { kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
    | {
        kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
        url: string
        ref: string
        path: string
        commit: string
      }
  revision: number
  enabled: boolean
  hooksTrusted: boolean
  manifest: PluginManifestDto
  skills: { name: string; description: string; path: string }[]
  configuredKeys: string[]
  missingKeys: string[]
  previousVersion?: string
  latestVersion?: string
  error?: string
  servers: {
    auth: McpAuthDto
    id: string
    name: string
    status: McpConnectionStatus
    error?: string
    toolCount: number
  }[]
}
export interface PluginListDto {
  revision: number
  installations: PluginInstallationDto[]
}
export interface PluginOperationDto {
  id: string
  status: PluginOperationStatus
  source:
    | { kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
    | {
        kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
        url: string
        ref: string
        path: string
        commit?: string
      }
  entry?: PluginEntryDto
  manifest?: PluginManifestDto
  skills?: { name: string; description: string; path: string }[]
  previousVersion?: string
  resetConfiguration?: boolean
  installationId?: string
  error?: string
}
