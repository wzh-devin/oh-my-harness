import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ChatActivePage,
  type ChatSubmitPayload,
  type ChatThread,
  archiveWorkspaceThreads,
  createPendingChatThread,
  findWorkspaceByThreadId,
  useAgentSessions,
  useWorkspaces,
} from '../features/chat/index.ts'
import { ChatPage } from '../pages/chat/index.ts'
import { ExplorePage } from '../pages/explore/index.ts'
import { LibraryPage } from '../pages/library/index.ts'
import { NewChatPage } from '../pages/new-chat/index.ts'
import { ChatLayout } from './ChatLayout.tsx'
import { resolveChatRoute } from './routing/index.ts'

/** 从浏览器历史状态中安全读取可选草稿，忽略其他页面写入的状态。 */
const readHistoryDraft = () => {
  const state: unknown = window.history.state

  if (!state || typeof state !== 'object') return ''

  const draft = (state as Record<string, unknown>).draft
  return typeof draft === 'string' ? draft : ''
}

/** 维护站内 URL 状态，并组合对应的聊天页面。 */
export function App() {
  const [draft, setDraft] = useState(readHistoryDraft)
  const [pathname, setPathname] = useState(window.location.pathname)
  const route = useMemo(() => resolveChatRoute(pathname), [pathname])
  const {
    abort,
    clearArchivedSessions,
    createSession,
    deleteSessionPermanently,
    errors,
    globalError,
    forgetSessions,
    isCreating,
    loadingIds,
    loadThread,
    pendingApprovals,
    refreshSessions,
    renameSession,
    resolveApproval,
    sendMessage,
    statuses,
    runPermissions,
    setSessionArchived,
    threads,
    updateModel,
  } = useAgentSessions()
  const activeThreads = useMemo(
    () => threads.filter((thread) => !thread.archived),
    [threads],
  )
  const archivedThreads = useMemo(
    () => threads.filter((thread) => thread.archived),
    [threads],
  )
  const {
    addWorkspace,
    error: workspaceError,
    isLoading: isWorkspaceLoading,
    removeWorkspace,
    workspaces,
  } = useWorkspaces()
  const selectedThread =
    route.kind === 'thread'
      ? threads.find((thread) => thread.id === route.threadId)
      : undefined

  const activePage = useMemo<ChatActivePage>(() => {
    if (route.kind === 'thread') {
      return {
        kind: 'thread',
        thread: selectedThread ?? createPendingChatThread(route.threadId),
      }
    }

    return { kind: route.kind }
  }, [route, selectedThread])
  const visibleWorkspaces = useMemo(
    () =>
      workspaces.map((workspace) => ({
        ...workspace,
        threadIds: activeThreads
          .filter((thread) => thread.workspaceId === workspace.id)
          .map((thread) => thread.id),
      })),
    [activeThreads, workspaces],
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')

  useEffect(() => {
    const threadWorkspaceId = selectedThread?.workspaceId
    const nextWorkspaceId =
      threadWorkspaceId &&
      workspaces.some((workspace) => workspace.id === threadWorkspaceId)
        ? threadWorkspaceId
        : workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
          ? selectedWorkspaceId
          : (workspaces[0]?.id ?? '')
    if (nextWorkspaceId !== selectedWorkspaceId) {
      // oxlint-disable-next-line react/set-state-in-effect -- Server workspace restore selects the first valid workspace.
      setSelectedWorkspaceId(nextWorkspaceId)
    }
  }, [selectedThread, selectedWorkspaceId, workspaces])

  const commitNavigation = useCallback(
    (path: string, nextDraft = '', replace = false) => {
      if (!path.startsWith('/') || path.startsWith('//')) return

      const nextRoute = resolveChatRoute(path)
      if (nextRoute.kind === 'thread') {
        const nextWorkspace = findWorkspaceByThreadId(
          visibleWorkspaces,
          nextRoute.threadId,
        )
        if (nextWorkspace) setSelectedWorkspaceId(nextWorkspace.id)
      }

      const method = replace ? 'replaceState' : 'pushState'
      window.history[method]({ draft: nextDraft }, '', path)
      setDraft(nextDraft)
      setPathname(window.location.pathname)
    },
    [visibleWorkspaces],
  )

  const navigate = useCallback(
    (path: string, nextDraft = '') => commitNavigation(path, nextDraft),
    [commitNavigation],
  )

  useEffect(() => {
    const handlePopState = () => {
      setDraft(readHistoryDraft())
      setPathname(window.location.pathname)

      const nextRoute = resolveChatRoute(window.location.pathname)
      if (nextRoute.kind === 'thread') {
        const nextWorkspace = findWorkspaceByThreadId(
          visibleWorkspaces,
          nextRoute.threadId,
        )
        if (nextWorkspace) setSelectedWorkspaceId(nextWorkspace.id)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [visibleWorkspaces])

  useEffect(() => {
    if (route.kind === 'thread') void loadThread(route.threadId)
  }, [loadThread, route])

  const handleNewChatSubmit = useCallback(
    async (payload: ChatSubmitPayload) => {
      try {
        const thread = await createSession(payload)
        setSelectedWorkspaceId(payload.workspaceId)
        void sendMessage(thread.id, payload)
        commitNavigation(`/${thread.id}`)
        return true
      } catch {
        return false
      }
    },
    [commitNavigation, createSession, sendMessage],
  )

  const handleThreadSubmit = useCallback(
    (thread: ChatThread, payload: ChatSubmitPayload) => {
      void sendMessage(thread.id, payload)
      return true
    },
    [sendMessage],
  )

  /** 永久删除归档会话，当前页命中时回到新建页。 */
  const handleArchivedDelete = useCallback(
    async (threadId: string) => {
      const error = await deleteSessionPermanently(threadId)
      if (!error && selectedThread?.id === threadId) commitNavigation('/new')
      return error
    },
    [commitNavigation, deleteSessionPermanently, selectedThread?.id],
  )

  /** 清空归档会话，并避免继续停留在可能已删除的会话路由。 */
  const handleArchivedClear = useCallback(async () => {
    const shouldNavigate = selectedThread?.archived === true
    const error = await clearArchivedSessions()
    if (shouldNavigate) commitNavigation('/new')
    return error
  }, [clearArchivedSessions, commitNavigation, selectedThread?.archived])

  /** 顺序归档工作区普通会话；部分失败时重新同步服务端权威列表。 */
  const handleWorkspaceArchiveAll = useCallback(
    async (workspaceId: string) => {
      const threadIds = activeThreads
        .filter((thread) => thread.workspaceId === workspaceId)
        .map((thread) => thread.id)
      const result = await archiveWorkspaceThreads(threadIds, (threadId) =>
        setSessionArchived(threadId, true),
      )
      if (result.failedCount === 0) return ''

      await refreshSessions()
      return `已归档 ${result.archivedCount} 条，${result.failedCount} 条失败：${result.firstError}`
    },
    [activeThreads, refreshSessions, setSessionArchived],
  )

  /** 删除工作区后清理所属会话；部分失败时重新校准服务端状态。 */
  const handleWorkspaceDelete = useCallback(
    async (workspaceId: string) => {
      const sessionIds = threads
        .filter((thread) => thread.workspaceId === workspaceId)
        .map((thread) => thread.id)
      const error = await removeWorkspace(workspaceId)
      if (error) {
        await refreshSessions()
        return error
      }
      forgetSessions(sessionIds)
      if (selectedThread?.workspaceId === workspaceId) commitNavigation('/new')
      return ''
    },
    [
      commitNavigation,
      forgetSessions,
      refreshSessions,
      removeWorkspace,
      selectedThread?.workspaceId,
      threads,
    ],
  )

  const page = (() => {
    switch (activePage.kind) {
      case 'explore':
        return <ExplorePage onNavigate={navigate} />
      case 'library':
        return <LibraryPage onNavigate={navigate} />
      case 'thread':
        return (
          <ChatPage
            activePermission={runPermissions[activePage.thread.id]}
            key={activePage.thread.id}
            error={errors[activePage.thread.id]}
            isLoading={loadingIds.has(activePage.thread.id)}
            pendingApproval={pendingApprovals[activePage.thread.id]}
            status={statuses[activePage.thread.id] ?? 'ready'}
            thread={activePage.thread}
            onRestore={() => setSessionArchived(activePage.thread.id, false)}
            onModelChange={(selection) =>
              updateModel(activePage.thread.id, selection)
            }
            onStop={() => void abort(activePage.thread.id)}
            onApprovalResolve={(decision) =>
              resolveApproval(activePage.thread.id, decision)
            }
            onSubmit={(payload) =>
              handleThreadSubmit(activePage.thread, payload)
            }
          />
        )
      case 'new':
        return (
          <NewChatPage
            draft={draft}
            error={globalError}
            status={isCreating ? 'submitted' : 'ready'}
            onDraftChange={setDraft}
            onSubmit={handleNewChatSubmit}
          />
        )
    }
  })()

  return (
    <ChatLayout
      activePage={activePage}
      archivedThreads={archivedThreads}
      isWorkspaceLoading={isWorkspaceLoading}
      selectedWorkspaceId={selectedWorkspaceId}
      threads={activeThreads}
      workspaces={visibleWorkspaces}
      onNavigate={navigate}
      onArchivedConversationDelete={handleArchivedDelete}
      onArchivedConversationsClear={handleArchivedClear}
      onThreadArchive={setSessionArchived}
      onThreadRename={renameSession}
      workspaceError={workspaceError}
      onWorkspaceAdd={addWorkspace}
      onWorkspaceArchiveAll={handleWorkspaceArchiveAll}
      onWorkspaceDelete={handleWorkspaceDelete}
      onWorkspaceSelect={setSelectedWorkspaceId}
    >
      {page}
    </ChatLayout>
  )
}
