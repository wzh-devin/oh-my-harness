import { useState } from 'react'
import { ChatMessageActions } from '@agile-avocation/ui-pro/chat-message-actions'
import { ChatMessage as ChatMessagePrimitive } from '@agile-avocation/ui-pro/chat-message'
import { CornerUpRight } from 'lucide-react'
import { MESSAGE_FEEDBACK, type MessageFeedback } from '@oh-my-harness/shared'

import type { ChatTokenUsage } from '../../types/chat-types.ts'
import { MessageTokenUsage } from './MessageTokenUsage.tsx'

interface MessageActionsProps {
  modelId?: string
  providerId?: string
  tokenUsage?: ChatTokenUsage
  compact?: boolean
  variant: 'full' | 'minimal'
  content?: string
  feedback?: MessageFeedback
  onFeedback?: (feedback: MessageFeedback | null) => void
  onFork?: () => void
  onRegenerate?: () => void
}

/** 展示消息的复制、反馈、重新生成和分支入口。 */
export function MessageActions({
  compact,
  variant,
  tokenUsage,
  modelId,
  providerId,
  content = '',
  feedback,
  onFeedback,
  onFork,
  onRegenerate,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div
      className={`flex flex-wrap items-center gap-1${compact ? ' mt-1' : ''}`}
    >
      <ChatMessageActions className="mt-0">
        <ChatMessageActions.Copy
          aria-label="复制"
          isCopied={copied}
          onPress={() => void copy()}
          tooltip="复制"
        />
        {variant === 'full' ? (
          <>
            <ChatMessageActions.ThumbsUp
              aria-label="回答有帮助"
              className={
                feedback === MESSAGE_FEEDBACK.POSITIVE
                  ? 'rounded-md bg-success/10 text-success'
                  : undefined
              }
              aria-pressed={feedback === MESSAGE_FEEDBACK.POSITIVE}
              onPress={() =>
                onFeedback?.(
                  feedback === MESSAGE_FEEDBACK.POSITIVE
                    ? null
                    : MESSAGE_FEEDBACK.POSITIVE,
                )
              }
              tooltip="回答有帮助"
            />
            <ChatMessageActions.ThumbsDown
              aria-label="回答需改进"
              className={
                feedback === MESSAGE_FEEDBACK.NEGATIVE
                  ? 'rounded-md bg-danger/10 text-danger'
                  : undefined
              }
              aria-pressed={feedback === MESSAGE_FEEDBACK.NEGATIVE}
              onPress={() =>
                onFeedback?.(
                  feedback === MESSAGE_FEEDBACK.NEGATIVE
                    ? null
                    : MESSAGE_FEEDBACK.NEGATIVE,
                )
              }
              tooltip="回答需改进"
            />
            <ChatMessageActions.Regenerate
              aria-label="重新生成"
              onPress={onRegenerate}
              tooltip="重新生成"
            />
          </>
        ) : null}
        {onFork ? (
          <ChatMessagePrimitive.Action
            aria-label="分支到新聊天"
            onPress={onFork}
            tooltip="分支到新聊天"
          >
            <CornerUpRight aria-hidden="true" className="size-4" />
          </ChatMessagePrimitive.Action>
        ) : null}
      </ChatMessageActions>
      {tokenUsage ? (
        <MessageTokenUsage
          usage={tokenUsage}
          modelId={modelId}
          providerId={providerId}
        />
      ) : null}
    </div>
  )
}
