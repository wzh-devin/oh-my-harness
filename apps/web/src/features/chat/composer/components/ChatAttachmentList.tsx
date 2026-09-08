import {
  ChatAttachment,
  ChatAttachmentGroup,
  formatChatAttachmentSize,
} from '@agile-avocation/ui-pro/chat-attachment'
import { Xmark } from '@gravity-ui/icons'
import { Button } from '@heroui/react'

interface ChatAttachmentListItem {
  id?: string
  mimeType?: string
  name: string
  size?: number
  src?: string
}

interface ChatAttachmentListProps {
  attachments: readonly ChatAttachmentListItem[]
  className?: string
  onRemove?: (attachment: ChatAttachmentListItem) => void
}

/** 渲染消息或草稿中的附件，并在允许时提供移除操作。 */
export function ChatAttachmentList({
  attachments,
  className = '',
  onRemove,
}: ChatAttachmentListProps) {
  if (attachments.length === 0) return null

  return (
    <ChatAttachmentGroup className={className}>
      {attachments.map((attachment, index) => (
        <ChatAttachment
          key={attachment.id ?? `${attachment.name}-${index}`}
          className="!flex !h-14 !w-56 !max-w-full items-center gap-2 !overflow-hidden !px-2"
          mimeType={attachment.mimeType}
          name={attachment.name}
          size={attachment.size}
          src={attachment.src}
        >
          <ChatAttachment.Preview className="!size-9 !shrink-0 !rounded-md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {attachment.name}
            </span>
            {attachment.size == null ? null : (
              <span className="block text-xs text-muted tabular-nums">
                {formatChatAttachmentSize(attachment.size)}
              </span>
            )}
          </span>
          {onRemove ? (
            <Button
              isIconOnly
              aria-label={`移除附件：${attachment.name}`}
              className="-mr-1 size-6 min-w-6"
              size="sm"
              variant="ghost"
              onPress={() => onRemove(attachment)}
            >
              <Xmark className="size-3.5" />
            </Button>
          ) : null}
        </ChatAttachment>
      ))}
    </ChatAttachmentGroup>
  )
}
