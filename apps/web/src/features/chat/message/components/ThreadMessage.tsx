import { ChatLoader } from '@agile-avocation/ui-pro/chat-loader'
import {
  CHAT_ASSISTANT_STATUS,
  MESSAGE_ROLE,
  type MessageFeedback,
} from '@oh-my-harness/shared'
import { ChatMessage as ChatMessagePrimitive } from '@agile-avocation/ui-pro/chat-message'
import { ChatSources } from '@agile-avocation/ui-pro/chat-source'
import { TextShimmer } from '@agile-avocation/ui-pro/text-shimmer'
import type { ChatMessage } from '../../types/chat-types.ts'
import { ChatAttachmentList } from '../../composer/components/ChatAttachmentList.tsx'
import { ComposerContextBar } from '../../composer/components/ComposerContextBar.tsx'
import { MessageTokenUsage } from './MessageTokenUsage.tsx'
import { MessageActions } from './MessageActions.tsx'
import { MessageMarkdown } from './MessageMarkdown.tsx'
import { MessageSource } from './MessageSource.tsx'
import { MessageTool } from './MessageTool.tsx'
import { ReasoningPanel } from './ReasoningPanel.tsx'
import { ToolActivity } from './ToolActivity.tsx'

interface ThreadMessageProps {
  compact?: boolean
  message: ChatMessage
  onFeedback?: (
    messageId: string,
    feedback: MessageFeedback | null,
  ) => void | Promise<void>
  onFork?: (messageId: string) => void | Promise<void>
  onRegenerate?: (messageId: string) => void | Promise<void>
}

/** 根据消息契约组合用户消息或助手消息。 */
export function ThreadMessage({
  compact,
  message,
  onFeedback,
  onFork,
  onRegenerate,
}: ThreadMessageProps) {
  if (message.role === MESSAGE_ROLE.USER) {
    return (
      <ChatMessagePrimitive.User>
        {message.contextItems?.length ? (
          <ComposerContextBar
            className="mb-2 justify-end"
            items={message.contextItems}
          />
        ) : null}
        {message.attachments?.length ? (
          <ChatAttachmentList
            attachments={message.attachments}
            className="mb-2"
          />
        ) : null}
        <ChatMessagePrimitive.Bubble>
          <ChatMessagePrimitive.Content>
            {message.text}
          </ChatMessagePrimitive.Content>
        </ChatMessagePrimitive.Bubble>
        {onFork ? (
          <MessageActions
            compact={compact}
            content={message.text ?? ''}
            onFork={() => void onFork(message.id)}
            variant="minimal"
          />
        ) : null}
      </ChatMessagePrimitive.User>
    )
  }

  if (message.activity) {
    return (
      <ChatMessagePrimitive.Assistant>
        <ChatMessagePrimitive.Avatar
          alt={message.avatar?.alt ?? '助手'}
          fallback={message.avatar?.fallback ?? 'AI'}
          show={message.showAvatar ?? false}
          src={message.avatar?.src}
        />
        <ChatMessagePrimitive.Body>
          <ToolActivity activity={message.activity} status={message.status} />
          {message.tokenUsage &&
          message.status === CHAT_ASSISTANT_STATUS.COMPLETE ? (
            <MessageTokenUsage
              usage={message.tokenUsage}
              modelId={message.modelId}
              providerId={message.providerId}
            />
          ) : null}
        </ChatMessagePrimitive.Body>
      </ChatMessagePrimitive.Assistant>
    )
  }

  return (
    <ChatMessagePrimitive.Assistant>
      <ChatMessagePrimitive.Avatar
        alt={message.avatar?.alt ?? '助手'}
        fallback={message.avatar?.fallback ?? 'AI'}
        show={message.showAvatar ?? false}
        src={message.avatar?.src}
      />

      <ChatMessagePrimitive.Body>
        {message.reasoning ? (
          <ReasoningPanel
            reasoning={message.reasoning}
            streaming={message.status === CHAT_ASSISTANT_STATUS.STREAMING}
          />
        ) : null}

        {message.tools?.map((tool, index) => (
          <MessageTool key={`${tool.toolName}-${index}`} tool={tool} />
        ))}

        {message.status === CHAT_ASSISTANT_STATUS.STREAMING ? (
          <>
            {message.text ? <TextShimmer>{message.text}</TextShimmer> : null}
            <ChatLoader.Dots />
          </>
        ) : null}

        {message.status === CHAT_ASSISTANT_STATUS.SKELETON ? (
          <ChatLoader.Skeleton label={message.loaderLabel ?? '正在加载回答'} />
        ) : null}

        {message.status !== CHAT_ASSISTANT_STATUS.STREAMING &&
        message.status !== CHAT_ASSISTANT_STATUS.SKELETON ? (
          <>
            {message.markdown || message.text ? (
              <ChatMessagePrimitive.Content>
                <MessageMarkdown>
                  {message.markdown || message.text || ''}
                </MessageMarkdown>
              </ChatMessagePrimitive.Content>
            ) : null}

            {message.listItems?.length ? (
              <ChatMessagePrimitive.Content>
                <ol className="list-decimal space-y-1 pl-6">
                  {message.listItems.map((listItem) => (
                    <li key={listItem}>{listItem}</li>
                  ))}
                </ol>
              </ChatMessagePrimitive.Content>
            ) : null}

            {message.image ? (
              <ChatMessagePrimitive.Media>
                <img
                  alt={message.image.alt}
                  className="aspect-square w-full max-w-[341px] rounded-2xl object-cover"
                  src={message.image.src}
                />
              </ChatMessagePrimitive.Media>
            ) : null}

            {message.sourceGroup ? (
              <ChatSources defaultExpanded={false}>
                <ChatSources.Trigger>
                  {message.sourceGroup.label}
                </ChatSources.Trigger>
                <ChatSources.Content>
                  <ChatSources.List>
                    {message.sourceGroup.sources.map((source, index) => (
                      <MessageSource
                        key={
                          source.sourceType === 'url'
                            ? `${source.url}-${index}`
                            : `${source.title}-${index}`
                        }
                        source={source}
                      />
                    ))}
                  </ChatSources.List>
                </ChatSources.Content>
              </ChatSources>
            ) : null}

            {message.sources?.map((source, index) => (
              <MessageSource key={`${source.title}-${index}`} source={source} />
            ))}

            {message.actions ? (
              <MessageActions
                compact={compact}
                content={message.markdown || message.text || ''}
                feedback={message.feedback}
                variant={message.actions}
                tokenUsage={message.tokenUsage}
                modelId={message.modelId}
                providerId={message.providerId}
                onFeedback={(feedback) =>
                  void onFeedback?.(message.id, feedback)
                }
                onFork={() => void onFork?.(message.id)}
                onRegenerate={() => void onRegenerate?.(message.id)}
              />
            ) : null}
          </>
        ) : null}
      </ChatMessagePrimitive.Body>
    </ChatMessagePrimitive.Assistant>
  )
}
