import type { ComponentType } from 'react'
import type { ToolPartState } from '@agile-avocation/ui-pro/chat-tool'
import type { ComposerContextItem } from '../composer/capabilities/composer-capabilities.ts'

export type ChatNavItemId = 'new' | 'library' | 'explore'

export interface ChatNavItem {
  href: string
  icon: ComponentType<{ className?: string }>
  id: ChatNavItemId
  label: string
}

export interface ChatSearchMode {
  id: string
  label: string
}

export interface ChatMessageImage {
  alt: string
  src: string
}

export interface ChatMessageReasoningStep {
  content: string
  label: string
}

export interface ChatMessageReasoning {
  defaultExpanded?: boolean
  duration?: number
  steps: readonly ChatMessageReasoningStep[]
}

export interface ChatMessageTool {
  approval?: {
    description?: string
    title: string
  }
  argsText?: string
  errorText?: string
  input?: unknown
  kind?: 'browser' | 'command' | 'edit' | 'read' | 'search' | 'skill' | 'tool'
  label?: string
  outcome?: {
    exitCode: number | null
    outputExceeded: boolean
    signal: string | null
    timedOut: boolean
  }
  output?: unknown
  state: ToolPartState
  toolCallId?: string
  toolName: string
}

export type ChatMessageSource =
  | {
      description?: string
      sourceType: 'url'
      title?: string
      url: string
    }
  | {
      sourceType: 'document'
      title: string
    }

export interface ChatMessageSourceGroup {
  label: string
  sources: readonly ChatMessageSource[]
}

export interface ChatMessageAttachment {
  mimeType?: string
  name: string
  src?: string
}

export type ChatAssistantStatus = 'complete' | 'skeleton' | 'streaming'

export interface ChatTodoItem {
  content: string
  status: 'completed' | 'in_progress' | 'pending'
}

export type ChatMessageActivityPart =
  | { reasoning: ChatMessageReasoning; type: 'reasoning' }
  | { text: string; type: 'text' }
  | { tool: ChatMessageTool; type: 'tool' }

export interface ChatMessageActivity {
  endedAt?: number
  hasError?: boolean
  parts?: readonly ChatMessageActivityPart[]
  reasoning?: ChatMessageReasoning
  startedAt?: number
  text?: string
  tools: readonly ChatMessageTool[]
}

export interface ChatMessage {
  actions?: 'full' | 'minimal'
  activity?: ChatMessageActivity
  attachments?: readonly ChatMessageAttachment[]
  contextItems?: readonly ComposerContextItem[]
  avatar?: {
    alt?: string
    fallback?: string
    src?: string
  }
  id: string
  image?: ChatMessageImage
  listItems?: readonly string[]
  loaderLabel?: string
  markdown?: string
  parts?: readonly ChatMessageActivityPart[]
  reasoning?: ChatMessageReasoning
  role: 'assistant' | 'user'
  showAvatar?: boolean
  sourceGroup?: ChatMessageSourceGroup
  sources?: readonly ChatMessageSource[]
  status?: ChatAssistantStatus
  text?: string
  tools?: readonly ChatMessageTool[]
}

export interface ChatThread {
  pluginIds?: readonly string[]
  archived: boolean
  contextUsage?: ChatContextUsage | undefined
  id: string
  messages: readonly ChatMessage[]
  modelId: string
  preview: string
  providerId?: string
  searchModeId: string
  title: string
  todos?: readonly ChatTodoItem[]
  updatedAt: string
  workspaceId?: null | string
  user: {
    avatar: string
    email: string
    name: string
  }
}

export interface ChatContextUsage {
  contextWindow: number
  messageTokens: number
  modelId: string
  providerId: string
  systemTokens: number
  toolsTokens: number
  usedTokens: number
}

export type ChatActivePage =
  | { kind: 'explore' }
  | { kind: 'library' }
  | { kind: 'new' }
  | { kind: 'thread'; thread: ChatThread }
