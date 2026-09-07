export type ManifestFormat = 'native' | 'codex' | 'claude'
export type CompatibilityIssue = {
  capability: string
  status: 'supported' | 'needs-configuration' | 'unsupported'
  message: string
}
export type PluginSource =
  | { type: 'git'; url: string; ref?: string; path?: string }
  | { type: 'zip'; name: string }
export type CatalogSource = PluginSource | { type: 'path'; path: string }
export type McpServerDefinition = {
  name: string
  transport: 'stdio' | 'http'
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
  kind: 'plugin' | 'marketplace'
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
