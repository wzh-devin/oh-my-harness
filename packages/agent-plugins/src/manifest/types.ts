import {
  PLUGIN_SOURCE_TYPE,
  type McpTransport,
  type PluginCompatibilityStatus,
  type PluginImportKind,
  type PluginManifestFormat,
} from '@oh-my-harness/shared'

export type ManifestFormat = PluginManifestFormat
export type CompatibilityIssue = {
  capability: string
  status: PluginCompatibilityStatus
  message: string
}
export type PluginSource =
  | {
      type: typeof PLUGIN_SOURCE_TYPE.GIT
      url: string
      ref?: string
      path?: string
    }
  | { type: typeof PLUGIN_SOURCE_TYPE.ZIP; name: string }
export type CatalogSource =
  | PluginSource
  | {
      type: typeof PLUGIN_SOURCE_TYPE.PATH
      path: string
    }
export type McpServerDefinition = {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
export type PluginDescriptor = {
  name: string
  description: string
  version?: string
  format: ManifestFormat
  skills: string[]
  commands: string[]
  servers: McpServerDefinition[]
  compatibility: CompatibilityIssue[]
  blocked: boolean
}
export type CatalogEntry = {
  id: string
  name: string
  description: string
  source?: CatalogSource
  definition?: Record<string, unknown>
  compatibility: CompatibilityIssue[]
}
export type MarketplaceDescriptor = {
  name: string
  displayName: string
  format: ManifestFormat
  entries: CatalogEntry[]
}
export type ImportCandidate = {
  key: string
  root: string
  format: ManifestFormat
  kind: PluginImportKind
}

export class PluginError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.status = status
  }
}
