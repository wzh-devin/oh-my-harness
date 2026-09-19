import { ChatMessageActions } from '@agile-avocation/ui-pro/chat-message-actions'

import type { ChatTokenUsage } from '../../types/chat-types.ts'
import { MessageTokenUsage } from './MessageTokenUsage.tsx'

interface MessageActionsProps {
  modelId?: string
  providerId?: string
  tokenUsage?: ChatTokenUsage
  compact?: boolean
  variant: 'full' | 'minimal'
}

/** 展示模板消息的复制、反馈和更多操作入口。 */
export function MessageActions({
  compact,
  variant,
  tokenUsage,
  modelId,
  providerId,
}: MessageActionsProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-1${compact ? ' mt-1' : ''}`}
    >
      <ChatMessageActions className="mt-0">
        <ChatMessageActions.Copy aria-label="复制" tooltip="复制" />
        {variant === 'full' ? (
          <>
            <ChatMessageActions.ThumbsUp
              aria-label="回答有帮助"
              tooltip="回答有帮助"
            />
            <ChatMessageActions.ThumbsDown
              aria-label="回答需改进"
              tooltip="回答需改进"
            />
            <ChatMessageActions.Regenerate
              aria-label="重新生成"
              tooltip="重新生成"
            />
          </>
        ) : null}
        <ChatMessageActions.Menu aria-label="更多" tooltip="更多操作" />
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
