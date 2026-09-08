import type { ComponentType } from 'react'
import type { ToolPartState } from '@agile-avocation/ui-pro/chat-tool'
import type { ComposerContextItem } from '../composer/capabilities/composer-capabilities.ts'
import {
  CHAT_MESSAGE_SOURCE_TYPE,
  CHAT_ROUTE_KIND,
  MESSAGE_PART_TYPE,
  type ChatAssistantStatus,
  type ChatRouteKind,
  type ChatToolKind,
  type MessageRole,
  type TodoStatus,
} from '@oh-my-harness/shared'

export type ChatNavItemId = Exclude<
  ChatRouteKind,
  typeof CHAT_ROUTE_KIND.THREAD
>

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
  kind?: ChatToolKind
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
      sourceType: typeof CHAT_MESSAGE_SOURCE_TYPE.URL
      title?: string
      url: string
    }
  | {
      sourceType: typeof CHAT_MESSAGE_SOURCE_TYPE.DOCUMENT
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

export type { ChatAssistantStatus }

export interface ChatTodoItem {
  content: string
  status: TodoStatus
}

export type ChatMessageActivityPart =
  | {
      reasoning: ChatMessageReasoning
      type: typeof MESSAGE_PART_TYPE.REASONING
    }
  | { text: string; type: typeof MESSAGE_PART_TYPE.TEXT }
  | { tool: ChatMessageTool; type: typeof MESSAGE_PART_TYPE.TOOL }

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
  role: MessageRole
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
  | { kind: typeof CHAT_ROUTE_KIND.EXPLORE }
  | { kind: typeof CHAT_ROUTE_KIND.LIBRARY }
  | { kind: typeof CHAT_ROUTE_KIND.NEW }
  | { kind: typeof CHAT_ROUTE_KIND.THREAD; thread: ChatThread }
