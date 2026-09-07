import type {
  CompatibilityIssue,
  ManifestFormat,
} from '@oh-my-harness/agent-plugins'

export interface PluginInstallationDto {
  id: string
  name: string
  description: string
  version?: string
  format: ManifestFormat
  enabled: boolean
  blocked: boolean
  revision: string
  canRollback: boolean
  source: string
  compatibility: CompatibilityIssue[]
  skills: number
  commands: number
}
export interface PluginMarketplaceDto {
  id: string
  name: string
  displayName: string
  format: ManifestFormat
  source: string
  entries: {
    id: string
    name: string
    description: string
    available: boolean
    installationId?: string
    compatibility: CompatibilityIssue[]
  }[]
}
