import { COMPLETION_EVENT_TYPE, type MessageRole } from '@oh-my-harness/shared'

export interface CompletionMessageDto {
  content: string
  role: MessageRole
}

export interface CompletionStreamRequestDto {
  messages: CompletionMessageDto[]
  modelId: string
  providerId: string
  systemPrompt?: string
}

export type CompletionEventDto =
  | { type: typeof COMPLETION_EVENT_TYPE.START }
  | { delta: string; type: typeof COMPLETION_EVENT_TYPE.TEXT_DELTA }
  | { delta: string; type: typeof COMPLETION_EVENT_TYPE.REASONING_DELTA }
  | {
      input: number
      output: number
      total: number
      type: typeof COMPLETION_EVENT_TYPE.USAGE
    }
  | { stopReason: string; type: typeof COMPLETION_EVENT_TYPE.DONE }
  | {
      code: string
      message: string
      type: typeof COMPLETION_EVENT_TYPE.ERROR
    }
