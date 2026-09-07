import type { ModelThinkingLevel } from '@earendil-works/pi-ai'

export type { ModelThinkingLevel } from '@earendil-works/pi-ai'

export interface AgentRunAttachment {
  content: string
  kind: 'image' | 'text'
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
  kind: 'command' | 'skill' | 'plugin'
  label: string
  reference: string
  sourceId: string
}
