import { ChatSource } from '@agile-avocation/ui-pro/chat-source'
import type { ChatMessageSource } from '../../types/chat-types.ts'

interface MessageSourceProps {
  source: ChatMessageSource
}

/** 将消息来源适配为 URL 或本地文档来源。 */
export function MessageSource({ source }: MessageSourceProps) {
  if (source.sourceType === 'url') {
    return (
      <ChatSource
        description={source.description}
        href={source.url}
        sourceType="url"
        title={source.title}
      />
    )
  }

  return <ChatSource sourceType="document" title={source.title} />
}
