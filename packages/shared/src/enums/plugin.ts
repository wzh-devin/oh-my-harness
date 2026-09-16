export const PLUGIN_OPERATION_STATUS = {
  FETCHING: 'fetching',
  READY: 'ready',
  COMMITTED: 'committed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type PluginOperationStatus =
  (typeof PLUGIN_OPERATION_STATUS)[keyof typeof PLUGIN_OPERATION_STATUS]

export const PLUGIN_SOURCE_KIND = {
  BUNDLED: 'bundled',
  GIT: 'git',
  UNSUPPORTED: 'unsupported',
} as const
export type PluginSourceKind =
  (typeof PLUGIN_SOURCE_KIND)[keyof typeof PLUGIN_SOURCE_KIND]

export const PLUGIN_FORMAT = {
  NATIVE: 'native',
  CODEX: 'codex',
  CLAUDE_CODE: 'claude-code',
} as const
export type PluginFormat = (typeof PLUGIN_FORMAT)[keyof typeof PLUGIN_FORMAT]

export const PLUGIN_INSTALLATION_SOURCE_KIND = {
  MARKET: 'market',
  DIRECT: 'direct',
} as const
export type PluginInstallationSourceKind =
  (typeof PLUGIN_INSTALLATION_SOURCE_KIND)[keyof typeof PLUGIN_INSTALLATION_SOURCE_KIND]

export const PLUGIN_INPUT_TARGET = { ENV: 'env', HEADERS: 'headers' } as const
export type PluginInputTarget =
  (typeof PLUGIN_INPUT_TARGET)[keyof typeof PLUGIN_INPUT_TARGET]

export const PLUGIN_ERROR_CODE = {
  INVALID: 'PLUGIN_INVALID',
  NOT_FOUND: 'PLUGIN_NOT_FOUND',
  CONFLICT: 'PLUGIN_CONFLICT',
  CONTENT_CHANGED: 'PLUGIN_CONTENT_CHANGED',
  UNAVAILABLE: 'PLUGIN_UNAVAILABLE',
  CORRUPT: 'PLUGIN_STATE_CORRUPT',
  LIMIT: 'PLUGIN_LIMIT',
  CONFIG_REQUIRED: 'PLUGIN_CONFIG_REQUIRED',
  REQUEST_REJECTED: 'PLUGIN_REQUEST_REJECTED',
} as const
export type PluginErrorCode =
  (typeof PLUGIN_ERROR_CODE)[keyof typeof PLUGIN_ERROR_CODE]
