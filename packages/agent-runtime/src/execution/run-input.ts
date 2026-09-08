import type {
  AgentContextKind,
  AttachmentKind,
  ModelThinkingLevel,
} from '@oh-my-harness/shared'

export type { ModelThinkingLevel } from '@oh-my-harness/shared'

export interface AgentRunAttachment {
  content: string
  kind: AttachmentKind
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
  contentIndex: number
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
