import type { MessageRole } from '@oh-my-harness/shared'

export interface CompletionMessage {
  content: string
  role: MessageRole
}

export interface CompletionRequest {
  messages: CompletionMessage[]
  modelId: string
  providerId: string
  systemPrompt?: string
}
