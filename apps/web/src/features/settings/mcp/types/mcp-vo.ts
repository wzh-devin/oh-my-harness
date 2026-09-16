import type {
  McpChangeKind,
  McpConnectionStatus,
  McpTransport,
} from '@oh-my-harness/shared'

export interface McpServerVo {
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
export interface McpListVo {
  revision: number
  servers: McpServerVo[]
}
export interface McpConfigVo {
  revision: number
  mcpServers: Record<string, McpServerVo['config']>
  secretKeys: Record<string, McpServerVo['secretKeys']>
}
export interface McpPreviewVo {
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
export interface McpToolVo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}
