export {
  PluginService,
  findCatalogInstallation,
} from './installation/plugin-service.ts'
export type {
  PluginImport,
  PluginInstallation,
  PluginMarketplace,
  PluginRevision,
  PluginSnapshot,
} from './installation/plugin-service.ts'
export { PluginError } from './manifest/types.ts'
export { extractZip, fetchGit, normalizeGitSource } from './source/fetch.ts'
export { inspectTree, resolveContentPath, exists } from './source/files.ts'
export type {
  CatalogEntry,
  CompatibilityIssue,
  ImportCandidate,
  ManifestFormat,
  MarketplaceDescriptor,
  McpServerDefinition,
  PluginDescriptor,
  PluginSource,
} from './manifest/types.ts'
