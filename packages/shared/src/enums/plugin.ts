export const PLUGIN_MANIFEST_FORMAT = {
  NATIVE: 'native',
  CODEX: 'codex',
  CLAUDE: 'claude',
} as const
export type PluginManifestFormat =
  (typeof PLUGIN_MANIFEST_FORMAT)[keyof typeof PLUGIN_MANIFEST_FORMAT]

export const PLUGIN_COMPATIBILITY_STATUS = {
  SUPPORTED: 'supported',
  NEEDS_CONFIGURATION: 'needs-configuration',
  UNSUPPORTED: 'unsupported',
} as const
export type PluginCompatibilityStatus =
  (typeof PLUGIN_COMPATIBILITY_STATUS)[keyof typeof PLUGIN_COMPATIBILITY_STATUS]

export const PLUGIN_SOURCE_TYPE = {
  GIT: 'git',
  ZIP: 'zip',
  PATH: 'path',
} as const

export const PLUGIN_IMPORT_KIND = {
  PLUGIN: 'plugin',
  MARKETPLACE: 'marketplace',
} as const
export type PluginImportKind =
  (typeof PLUGIN_IMPORT_KIND)[keyof typeof PLUGIN_IMPORT_KIND]

export const PLUGIN_COLLECTION_KIND = {
  MARKETPLACES: 'marketplaces',
  INSTALLATIONS: 'installations',
} as const
export type PluginCollectionKind =
  (typeof PLUGIN_COLLECTION_KIND)[keyof typeof PLUGIN_COLLECTION_KIND]

export const PLUGIN_REGISTRY_ITEM_KIND = {
  MARKETPLACE: 'marketplace',
  INSTALLATION: 'installation',
} as const
export type PluginRegistryItemKind =
  (typeof PLUGIN_REGISTRY_ITEM_KIND)[keyof typeof PLUGIN_REGISTRY_ITEM_KIND]

export const PLUGIN_IMPORT_STATUS = {
  FETCHING: 'fetching',
  READY: 'ready',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type PluginImportStatus =
  (typeof PLUGIN_IMPORT_STATUS)[keyof typeof PLUGIN_IMPORT_STATUS]

export const MCP_TRANSPORT = {
  STDIO: 'stdio',
  HTTP: 'http',
} as const
export type McpTransport = (typeof MCP_TRANSPORT)[keyof typeof MCP_TRANSPORT]

export const MCP_OAUTH_STATUS = {
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const
export type McpOAuthStatus =
  (typeof MCP_OAUTH_STATUS)[keyof typeof MCP_OAUTH_STATUS]

export const MCP_AUTH_STATUS = {
  NOT_REQUIRED: 'not-required',
  DISCONNECTED: 'disconnected',
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  REAUTH_REQUIRED: 'reauth-required',
} as const
export type McpAuthStatus =
  (typeof MCP_AUTH_STATUS)[keyof typeof MCP_AUTH_STATUS]

export const MCP_RUNTIME_CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  READY: 'ready',
  ERROR: 'error',
} as const
export type McpRuntimeConnectionStatus =
  (typeof MCP_RUNTIME_CONNECTION_STATUS)[keyof typeof MCP_RUNTIME_CONNECTION_STATUS]

export const MCP_SETTINGS_CONNECTION_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const
export type McpSettingsConnectionStatus =
  (typeof MCP_SETTINGS_CONNECTION_STATUS)[keyof typeof MCP_SETTINGS_CONNECTION_STATUS]
