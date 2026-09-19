import { Command } from '@agile-avocation/ui-pro/command'
import { Comment, Magnifier } from '@gravity-ui/icons'
import { Kbd } from '@heroui/react'
import type { ChatThread } from '../../types/chat-types.ts'

interface ChatSearchDialogProps {
  isOpen: boolean
  threads: readonly ChatThread[]
  onOpenChange: (open: boolean) => void
  onSelect: (thread: ChatThread) => void
}

/** 提供可键盘操作的最近会话搜索弹窗。 */
export function ChatSearchDialog({
  isOpen,
  onOpenChange,
  onSelect,
  threads,
}: ChatSearchDialogProps) {
  return (
    <Command>
      <Command.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Command.Container>
          <Command.Dialog aria-label="对话搜索">
            <Command.InputGroup aria-label="搜索对话">
              <Command.InputGroup.Prefix>
                <Magnifier />
              </Command.InputGroup.Prefix>
              <Command.InputGroup.Input placeholder="搜索你的对话" />
              <Command.InputGroup.ClearButton aria-label="清除搜索" />
              <Command.InputGroup.Suffix>
                <Kbd className="text-xs">
                  <Kbd.Content>Esc</Kbd.Content>
                </Kbd>
              </Command.InputGroup.Suffix>
            </Command.InputGroup>

            <Command.List
              renderEmptyState={() => (
                <div className="flex h-16 items-center justify-center text-sm text-muted">
                  没有找到匹配的对话。
                </div>
              )}
            >
              <Command.Group heading="最近对话">
                {threads.map((thread) => (
                  <Command.Item
                    key={thread.id}
                    textValue={`${thread.title} ${thread.preview}`}
                    onAction={() => onSelect(thread)}
                  >
                    <Comment />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {thread.title}
                      </span>
                      <span className="truncate text-xs text-muted">
                        {thread.preview}
                      </span>
                    </div>
                    <span className="ml-auto shrink-0 text-[11px] text-muted">
                      {thread.updatedAt}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>

            <Command.Footer className="justify-between [&_kbd]:h-5 [&_kbd]:text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    <Kbd className="text-xs">
                      <Kbd.Abbr keyValue="up" />
                    </Kbd>
                    <Kbd className="text-xs">
                      <Kbd.Abbr keyValue="down" />
                    </Kbd>
                  </div>
                  <span>选择</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>
                    <Kbd.Abbr keyValue="enter" />
                  </Kbd>
                  <span>打开对话</span>
                </div>
              </div>
            </Command.Footer>
          </Command.Dialog>
        </Command.Container>
      </Command.Backdrop>
    </Command>
  )
}
