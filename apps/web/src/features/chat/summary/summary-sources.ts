import { CHAT_MESSAGE_SOURCE_TYPE } from '@oh-my-harness/shared'
import type { ChatMessage } from '../types/chat-types.ts'

export interface SummarySource {
  id: string
  mimeType?: string
  title: string
}

/** 汇总真实消息来源，最近消息优先；按资源标识去重，不合并同名不同文件。 */
export const collectSummarySources = (
  messages: readonly ChatMessage[],
): SummarySource[] => {
  const sourceMap = new Map<string, SummarySource>()
  for (const message of messages.toReversed()) {
    const sourceList: SummarySource[] = [
      ...(message.attachments ?? []).map((attachment, index) => ({
        id: `attachment:${attachment.src ?? `${message.id}:${index}`}`,
        mimeType: attachment.mimeType,
        title: attachment.name,
      })),
      ...[
        ...(message.sources ?? []),
        ...(message.sourceGroup?.sources ?? []),
      ].map((source) => ({
        id:
          source.sourceType === CHAT_MESSAGE_SOURCE_TYPE.URL
            ? `url:${source.url}`
            : `document:${source.title}`,
        title:
          source.sourceType === CHAT_MESSAGE_SOURCE_TYPE.URL
            ? source.title || source.url
            : source.title,
      })),
    ]
    for (const source of sourceList) {
      if (!sourceMap.has(source.id)) sourceMap.set(source.id, source)
    }
  }
  return [...sourceMap.values()]
}
