export const MCP_TRANSPORT = { STDIO: 'stdio', HTTP: 'http' } as const
export type McpTransport = (typeof MCP_TRANSPORT)[keyof typeof MCP_TRANSPORT]

export const MCP_CONNECTION_STATUS = {
  DISABLED: 'disabled',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const
export type McpConnectionStatus =
  (typeof MCP_CONNECTION_STATUS)[keyof typeof MCP_CONNECTION_STATUS]

export const MCP_CHANGE_KIND = {
  ADD: 'add',
  UPDATE: 'update',
  DELETE: 'delete',
} as const
export type McpChangeKind =
  (typeof MCP_CHANGE_KIND)[keyof typeof MCP_CHANGE_KIND]

export const MCP_ERROR_CODE = {
  INVALID_CONFIG: 'MCP_INVALID_CONFIG',
  CONFIG_CORRUPT: 'MCP_CONFIG_CORRUPT',
  CONFIG_CONFLICT: 'MCP_CONFIG_CONFLICT',
  DELETE_CONFIRMATION: 'MCP_DELETE_CONFIRMATION',
  SERVER_BUSY: 'MCP_SERVER_BUSY',
  NOT_FOUND: 'MCP_NOT_FOUND',
  UNAVAILABLE: 'MCP_UNAVAILABLE',
  CALL_FAILED: 'MCP_CALL_FAILED',
  REQUEST_REJECTED: 'MCP_REQUEST_REJECTED',
} as const
export type McpErrorCode = (typeof MCP_ERROR_CODE)[keyof typeof MCP_ERROR_CODE]

export const MCP_AUTH_STATUS = {
  NOT_CONNECTED: 'not_connected',
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  RECONNECT_REQUIRED: 'reconnect_required',
  SETUP_REQUIRED: 'setup_required',
  ERROR: 'error',
} as const
export type McpAuthStatus =
  (typeof MCP_AUTH_STATUS)[keyof typeof MCP_AUTH_STATUS]
export const MCP_AUTH_METHOD = {
  OAUTH: 'oauth',
  DEVICE: 'device',
  CREDENTIALS: 'credentials',
} as const
export type McpAuthMethod =
  (typeof MCP_AUTH_METHOD)[keyof typeof MCP_AUTH_METHOD]
export const MCP_AUTH_SESSION_STATUS = {
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const
export type McpAuthSessionStatus =
  (typeof MCP_AUTH_SESSION_STATUS)[keyof typeof MCP_AUTH_SESSION_STATUS]
export const MCP_AUTH_POLICY = {
  ON_INSTALL: 'ON_INSTALL',
  ON_USE: 'ON_USE',
} as const
export type McpAuthPolicy =
  (typeof MCP_AUTH_POLICY)[keyof typeof MCP_AUTH_POLICY]
