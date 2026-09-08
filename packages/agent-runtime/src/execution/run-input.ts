import type {
  AgentContextKind,
  ModelThinkingLevel,
} from '@oh-my-harness/shared'

export type { ModelThinkingLevel } from '@oh-my-harness/shared'

export interface AgentRunAttachment {
  data: Uint8Array
  mimeType: string
  name: string
  size: number
}

export interface AgentRunInput {
  attachments?: readonly AgentRunAttachment[]
  commandId?: string
  content: string
  skillIds?: readonly string[]
  pluginIds?: readonly string[]
  thinkingLevel?: ModelThinkingLevel
}

export interface AgentMessageAttachment {
  id: string
  mimeType: string
  name: string
  size: number
}

export interface AgentMessageContextItem {
  description: string
  id: string
  kind: AgentContextKind
  label: string
  reference: string
  sourceId: string
}
