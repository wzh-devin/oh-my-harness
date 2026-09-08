import { AppLayout } from '@agile-avocation/ui-pro/app-layout'
import { CHAT_ROUTE_KIND } from '@oh-my-harness/shared'
import { Navbar } from '@agile-avocation/ui-pro/navbar'
import { Magnifier } from '@gravity-ui/icons'
import { Button, Kbd, Tooltip } from '@heroui/react'
import type { ChatActivePage } from '../../data/chat-types.ts'

const NAV_TITLES: Record<
  Exclude<ChatActivePage['kind'], typeof CHAT_ROUTE_KIND.THREAD>,
  { subtitle: string; title: string }
> = {
  [CHAT_ROUTE_KIND.EXPLORE]: {
    subtitle: '选择预设提示词，开始新的对话',
    title: '探索',
  },
  [CHAT_ROUTE_KIND.LIBRARY]: {
    subtitle: '资料保存与管理功能尚未开放',
    title: '资料库',
  },
  [CHAT_ROUTE_KIND.NEW]: {
    subtitle: '开始一段全新的对话',
    title: '新建对话',
  },
}

interface ChatNavbarProps {
  activePage: ChatActivePage
  onSearch: () => void
}

/** 展示非会话页标题，并为移动端提供导航与聊天搜索入口。 */
export function ChatNavbar({ activePage, onSearch }: ChatNavbarProps) {
  const isThread = activePage.kind === CHAT_ROUTE_KIND.THREAD
  const title = isThread
    ? activePage.thread.title
    : NAV_TITLES[activePage.kind].title
  const subtitle = isThread
    ? `更新于${activePage.thread.updatedAt}`
    : NAV_TITLES[activePage.kind].subtitle

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle aria-label="打开导航" />
        {isThread ? null : (
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">
              {title}
            </h1>
            <span className="truncate text-xs text-muted">{subtitle}</span>
          </div>
        )}
        <Navbar.Spacer />
        <div className="flex items-center gap-2">
          <Tooltip delay={0}>
            <Button
              aria-label="搜索对话"
              className="md:hidden"
              size="sm"
              variant="tertiary"
              onPress={onSearch}
            >
              <Magnifier className="size-4" />
              <span className="hidden sm:inline">搜索</span>
            </Button>
            <Tooltip.Content placement="bottom">
              <div className="flex items-center gap-2 text-xs">
                <span>搜索对话</span>
                <Kbd className="text-[10px]">⌘K</Kbd>
              </div>
            </Tooltip.Content>
          </Tooltip>
        </div>
      </Navbar.Header>
    </Navbar>
  )
}
