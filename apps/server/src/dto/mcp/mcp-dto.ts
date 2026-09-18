import type {
  McpAuthStatus,
  McpAuthMethod,
  McpAuthSessionStatus,
} from '@oh-my-harness/shared'
import type {
  McpChangeKind,
  McpConnectionStatus,
  McpTransport,
} from '@oh-my-harness/shared'

export interface McpServerDto {
  auth: McpAuthDto
  owner?: { id: string; name: string }
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  revision: number
  config: { command?: string; args?: string[]; url?: string; enabled: boolean }
  secretKeys: { env: string[]; headers: string[] }
  status: McpConnectionStatus
  error?: string
  checkedAt?: string
  toolCount: number
  activeSessionIds: string[]
}
export interface McpListDto {
  revision: number
  servers: McpServerDto[]
}
export interface McpPreviewDto {
  revision: number
  changes: {
    id: string
    name: string
    kind: McpChangeKind
    fields: {
      path: string
      kind: McpChangeKind
      sensitive: boolean
      before?: string
      after?: string
    }[]
  }[]
}

export interface McpAuthDto {
  status: McpAuthStatus
  method: McpAuthMethod
  accountName?: string
  error?: string
  credentialKeys: string[]
  setupUrl?: string
}
export interface McpAuthSessionDto {
  id: string
  status: McpAuthSessionStatus
  expiresAt: number
  authorizationUrl?: string
  userCode?: string
  verificationUri?: string
  error?: string
}
