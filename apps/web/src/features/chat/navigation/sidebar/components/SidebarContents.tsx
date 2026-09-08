import { useState } from 'react'
import { CHAT_ROUTE_KIND } from '@oh-my-harness/shared'
import { Sidebar, useSidebar } from '@agile-avocation/ui-pro/sidebar'
import {
  Archive,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Gear,
  Magnifier,
  Pencil,
  SquarePlus,
  TrashBin,
} from '@gravity-ui/icons'
import { Button, Dropdown, Tooltip } from '@heroui/react'
import { DestructiveActionDialog } from '../../../../../components/index.ts'
import { CHAT_NAV_ITEMS } from '../../../data/chat-navigation.ts'
import type { ChatThread } from '../../../data/chat-types.ts'
import type { ChatSidebarProps } from '../types/chat-sidebar.ts'

interface SidebarContentsProps extends Omit<
  ChatSidebarProps,
  'isWorkspaceLoading' | 'onWorkspaceAdd'
> {
  expandedWorkspaceIds: ReadonlySet<string>
  idPrefix?: string
  isAddingWorkspace: boolean
  onAddWorkspace: () => Promise<void>
  onWorkspaceToggle: (workspaceId: string) => void
  workspaceError: string
}

interface ConversationItemProps {
  idPrefix: string
  isCurrent: boolean
  onArchive: (threadId: string) => Promise<string>
  onError: (message: string) => void
  onRename: (threadId: string, name: string) => Promise<string>
  thread: ChatThread
}

function ConversationItem({
  idPrefix,
  isCurrent,
  onArchive,
  onError,
  onRename,
  thread,
}: ConversationItemProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [name, setName] = useState(thread.title)

  const saveName = async () => {
    const nextName = name.trim()
    if (!nextName) {
      onError('对话名称不能为空。')
      return
    }
    const error = await onRename(thread.id, nextName)
    if (error) onError(error)
    else setIsRenaming(false)
  }

  const archive = async () => {
    setIsArchiving(true)
    const error = await onArchive(thread.id)
    if (error) {
      onError(error)
      setIsArchiving(false)
    }
  }

  return (
    <Sidebar.MenuItem
      className="focus-within:[&_.sidebar__menu-actions]:flex"
      href={isRenaming ? undefined : `/${thread.id}`}
      id={`${idPrefix}${thread.id}`}
      isCurrent={isCurrent}
      textValue={thread.title}
    >
      <Sidebar.MenuLabel className="min-w-0">
        {isRenaming ? (
          <input
            autoFocus
            aria-label="对话名称"
            className="h-7 w-full rounded-md border border-accent bg-background px-2 text-sm text-foreground outline-none"
            maxLength={200}
            value={name}
            onBlur={() => {
              setName(thread.title)
              setIsRenaming(false)
            }}
            onChange={(event) => setName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                void saveName()
              } else if (event.key === 'Escape') {
                setName(thread.title)
                setIsRenaming(false)
              }
            }}
          />
        ) : (
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate">{thread.title}</span>
            <span className="shrink-0 text-xs text-muted">
              {thread.updatedAt}
            </span>
          </span>
        )}
      </Sidebar.MenuLabel>
      {!isRenaming ? (
        <Sidebar.MenuActions>
          <Dropdown>
            <Dropdown.Trigger
              aria-label={`管理对话：${thread.title}`}
              className="sidebar__menu-action"
              isDisabled={isArchiving}
              onClick={(event) => event.stopPropagation()}
            >
              <Ellipsis className="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Popover className="min-w-40" placement="bottom end">
              <Dropdown.Menu
                aria-label="对话操作"
                onAction={(key) => {
                  if (key === 'rename') {
                    setName(thread.title)
                    setIsRenaming(true)
                  } else if (key === 'archive') {
                    void archive()
                  }
                }}
              >
                <Dropdown.Item id="rename" textValue="重命名">
                  <Pencil className="size-4" />
                  重命名
                </Dropdown.Item>
                <Dropdown.Item id="archive" textValue="归档">
                  <Archive className="size-4" />
                  归档
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </Sidebar.MenuActions>
      ) : null}
    </Sidebar.MenuItem>
  )
}

/** 复用桌面与移动导航内容，并标记当前页面或会话。 */
export function SidebarContents({
  activePage,
  expandedWorkspaceIds,
  idPrefix = '',
  isAddingWorkspace,
  onAddWorkspace,
  onSearch,
  onSettings,
  onThreadArchive,
  onThreadRename,
  onWorkspaceArchiveAll,
  onWorkspaceNewChat,
  onWorkspaceToggle,
  onWorkspaceDelete,
  selectedWorkspaceId,
  threads,
  workspaceError,
  workspaces,
}: SidebarContentsProps) {
  const [sessionError, setSessionError] = useState('')
  const [workspaceToDelete, setWorkspaceToDelete] =
    useState<ChatSidebarProps['workspaces'][number]>()
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState('')
  const [workspaceToArchiveId, setWorkspaceToArchiveId] = useState('')
  const [isArchivingWorkspace, setIsArchivingWorkspace] = useState(false)
  const [workspaceArchiveError, setWorkspaceArchiveError] = useState('')
  const { isMobile, isOpen, setMobileOpen } = useSidebar()
  const isCollapsed = !isMobile && !isOpen
  const visibleNavItems = isCollapsed
    ? CHAT_NAV_ITEMS.filter((item) => item.id === CHAT_ROUTE_KIND.NEW)
    : CHAT_NAV_ITEMS
  const handleSettings = () => {
    if (isMobile) setMobileOpen(false)
    onSettings()
  }
  const workspaceToArchive = workspaces.find(
    (workspace) => workspace.id === workspaceToArchiveId,
  )

  /** 归档工作区内当前全部普通会话，并保留部分失败信息供重试。 */
  const archiveWorkspace = async () => {
    if (!workspaceToArchive) return
    setIsArchivingWorkspace(true)
    setWorkspaceArchiveError('')
    const error = await onWorkspaceArchiveAll(workspaceToArchive.id)
    setWorkspaceArchiveError(error)
    setIsArchivingWorkspace(false)
    if (!error) setWorkspaceToArchiveId('')
  }

  /** 删除工作区及会话，并保留失败信息供用户重试。 */
  const deleteWorkspace = async () => {
    if (!workspaceToDelete) return
    setIsDeletingWorkspace(true)
    setWorkspaceDeleteError('')
    const error = await onWorkspaceDelete(workspaceToDelete.id)
    setWorkspaceDeleteError(error)
    setIsDeletingWorkspace(false)
    if (!error) setWorkspaceToDelete(undefined)
  }

  return (
    <>
      <Sidebar.Header>
        <div
          className={`flex h-11 w-full items-center gap-2 px-1 ${isCollapsed ? 'justify-center' : 'justify-between'}`}
        >
          {isCollapsed ? (
            <Tooltip delay={0}>
              <Sidebar.Trigger
                aria-label="展开侧边栏"
                style={{ marginInlineStart: 0 }}
              />
              <Tooltip.Content placement="right">展开侧边栏</Tooltip.Content>
            </Tooltip>
          ) : (
            <>
              <span className="min-w-0 truncate whitespace-nowrap text-xl leading-none font-semibold tracking-tight text-foreground">
                oh-my-harness
              </span>
              <div className="flex items-center gap-2">
                <Button
                  isIconOnly
                  aria-label="搜索对话"
                  size="sm"
                  variant="ghost"
                  onPress={onSearch}
                >
                  <Magnifier className="size-4" />
                </Button>
                <Sidebar.Trigger
                  aria-label="收起侧边栏"
                  style={{ marginInlineStart: 0 }}
                />
              </div>
            </>
          )}
        </div>
      </Sidebar.Header>

      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu
            aria-label={isCollapsed ? '快捷操作' : '对话操作'}
            style={isCollapsed ? { gap: '0.75rem' } : undefined}
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon

              return (
                <Sidebar.MenuItem
                  key={item.id}
                  href={item.href}
                  id={`${idPrefix}${item.id}`}
                  isCurrent={activePage.kind === item.id}
                  textValue={item.label}
                >
                  <Sidebar.MenuIcon>
                    <Icon className="size-4" />
                  </Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              )
            })}
            {isCollapsed ? (
              <Sidebar.MenuItem
                id={`${idPrefix}search`}
                textValue="搜索对话"
                onAction={onSearch}
              >
                <Sidebar.MenuIcon>
                  <Magnifier className="size-4" />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>搜索对话</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ) : null}
          </Sidebar.Menu>
        </Sidebar.Group>

        {!isCollapsed ? (
          <>
            <Sidebar.Separator />
            <Sidebar.Group>
              <div className="mb-1 flex h-8 items-center justify-between pr-2 pl-2.5">
                <Sidebar.GroupLabel className="!p-0">工作区</Sidebar.GroupLabel>
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    aria-label="添加工作区"
                    isDisabled={isAddingWorkspace}
                    size="sm"
                    variant="ghost"
                    onPress={() => void onAddWorkspace()}
                  >
                    <FolderPlus className="size-4" />
                  </Button>
                  <Tooltip.Content placement="right">
                    添加工作区
                  </Tooltip.Content>
                </Tooltip>
              </div>

              <div aria-label="工作区" className="space-y-1">
                {workspaces.map((workspace) => {
                  const workspaceThreads = threads.filter((thread) =>
                    workspace.threadIds.includes(thread.id),
                  )
                  const isExpanded = expandedWorkspaceIds.has(workspace.id)
                  const isSelected = selectedWorkspaceId === workspace.id
                  const WorkspaceFolderIcon = isExpanded ? FolderOpen : Folder

                  return (
                    <section key={workspace.id}>
                      <div className="group/workspace flex items-center">
                        <Button
                          fullWidth
                          aria-expanded={isExpanded}
                          className="h-9 min-h-9 min-w-0 justify-start gap-4 rounded-2xl pr-10 pl-3 font-normal"
                          size="sm"
                          variant="ghost"
                          onPress={() => onWorkspaceToggle(workspace.id)}
                        >
                          <WorkspaceFolderIcon
                            className={`size-4 shrink-0 ${isSelected ? 'text-accent' : 'text-muted'}`}
                          />
                          <span className="truncate">{workspace.label}</span>
                          {!workspace.available ? (
                            <span className="ml-auto shrink-0 text-xs text-danger">
                              不可用
                            </span>
                          ) : null}
                        </Button>
                        <Dropdown>
                          <Dropdown.Trigger
                            aria-label={`管理工作区：${workspace.label}`}
                            className="-ml-9 mr-1 size-8 shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/workspace:opacity-100 md:group-hover/workspace:opacity-100"
                            isDisabled={
                              isDeletingWorkspace || isArchivingWorkspace
                            }
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Ellipsis className="size-4" />
                          </Dropdown.Trigger>
                          <Dropdown.Popover
                            className="min-w-40"
                            placement="bottom end"
                          >
                            <Dropdown.Menu
                              aria-label="工作区操作"
                              onAction={(key) => {
                                if (key === 'new-chat') {
                                  onWorkspaceNewChat(workspace.id)
                                  if (isMobile) setMobileOpen(false)
                                } else if (key === 'archive-all') {
                                  setWorkspaceArchiveError('')
                                  setWorkspaceToArchiveId(workspace.id)
                                } else if (key === 'delete') {
                                  setWorkspaceToDelete(workspace)
                                }
                              }}
                            >
                              <Dropdown.Item
                                id="new-chat"
                                isDisabled={!workspace.available}
                                textValue="新建对话"
                              >
                                <SquarePlus className="size-4" />
                                新建对话
                              </Dropdown.Item>
                              <Dropdown.Item
                                id="archive-all"
                                isDisabled={workspaceThreads.length === 0}
                                textValue="归档所有对话"
                              >
                                <Archive className="size-4" />
                                归档所有对话
                              </Dropdown.Item>
                              <Dropdown.Item
                                className="text-danger"
                                id="delete"
                                textValue="删除工作区"
                              >
                                <TrashBin className="size-4" />
                                删除工作区
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>

                      {isExpanded ? (
                        workspaceThreads.length > 0 ? (
                          <Sidebar.Menu
                            aria-label={`${workspace.label}中的对话`}
                            className="mt-0.5 pl-5"
                            showGuideLines={false}
                          >
                            {workspaceThreads.map((thread) => (
                              <ConversationItem
                                key={thread.id}
                                idPrefix={idPrefix}
                                isCurrent={
                                  activePage.kind === CHAT_ROUTE_KIND.THREAD &&
                                  activePage.thread.id === thread.id
                                }
                                thread={thread}
                                onArchive={onThreadArchive}
                                onError={setSessionError}
                                onRename={onThreadRename}
                              />
                            ))}
                          </Sidebar.Menu>
                        ) : (
                          <p className="py-2 pr-2 pl-7 text-xs text-muted">
                            暂无对话
                          </p>
                        )
                      ) : null}
                    </section>
                  )
                })}
                {workspaces.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted">
                    {isAddingWorkspace
                      ? '正在加载工作区…'
                      : '暂无工作区，请先添加本地目录。'}
                  </p>
                ) : null}
              </div>

              {workspaceError ? (
                <p aria-live="polite" className="mt-2 px-2 text-xs text-danger">
                  {workspaceError}
                </p>
              ) : null}
              {sessionError ? (
                <p aria-live="polite" className="mt-2 px-2 text-xs text-danger">
                  {sessionError}
                </p>
              ) : null}
            </Sidebar.Group>
          </>
        ) : null}
      </Sidebar.Content>

      <Sidebar.Footer>
        <Sidebar.Menu aria-label="应用设置">
          <Sidebar.MenuItem
            id={`${idPrefix}settings`}
            textValue="设置"
            onAction={handleSettings}
          >
            <Sidebar.MenuIcon>
              <Gear className="size-4" />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>设置</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Footer>

      {workspaceToDelete ? (
        <DestructiveActionDialog
          confirmLabel="删除工作区"
          description={`将从 oh-my-harness 中删除“${workspaceToDelete.label}”及其全部普通、归档对话。本地工作区目录和源码不会被删除，此操作无法撤销会话记录。`}
          error={workspaceDeleteError}
          isPending={isDeletingWorkspace}
          title="删除工作区"
          onClose={() => {
            setWorkspaceDeleteError('')
            setWorkspaceToDelete(undefined)
          }}
          onConfirm={() => void deleteWorkspace()}
        />
      ) : null}
      {workspaceToArchive ? (
        <DestructiveActionDialog
          confirmLabel="归档所有对话"
          confirmVariant="primary"
          description={`将归档“${workspaceToArchive.label}”中的全部 ${workspaceToArchive.threadIds.length} 条对话。归档后可在设置中恢复。`}
          error={workspaceArchiveError}
          isPending={isArchivingWorkspace}
          pendingLabel="正在归档…"
          title="归档所有对话"
          onClose={() => {
            setWorkspaceArchiveError('')
            setWorkspaceToArchiveId('')
          }}
          onConfirm={() => void archiveWorkspace()}
        />
      ) : null}
    </>
  )
}
