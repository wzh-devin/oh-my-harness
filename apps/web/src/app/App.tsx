import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CHAT_ROUTE_KIND } from '@oh-my-harness/shared'
import {
  type ChatActivePage,
  type ChatSubmitPayload,
  type ChatThread,
  archiveWorkspaceThreads,
  createPendingChatThread,
  findWorkspaceByThreadId,
  useAgentSessions,
  useWorkspaces,
  ToolExecutionConsole,
  ServiceSummary,
  useToolExecutions,
  projectToolExecutions,
} from '../features/chat/index.ts'
import { ChatPage } from '../pages/chat/index.ts'
import { ExplorePage } from '../pages/explore/index.ts'
import { LibraryPage } from '../pages/library/index.ts'
import { NewChatPage } from '../pages/new-chat/index.ts'
import { ChatLayout } from './ChatLayout.tsx'
import { PinnedSummary } from '../features/chat/summary/components/index.ts'
import { useWorkspaceGit } from '../features/chat/summary/use-workspace-git.ts'
import { getSummarySections } from '../features/chat/summary/summary-sections.ts'
import { resolveChatRoute } from './routing/index.ts'

const GitReviewPanel = lazy(
  () => import('../features/chat/summary/components/GitReviewPanel.tsx'),
)

/** 从浏览器历史状态中安全读取可选草稿，忽略其他页面写入的状态。 */
const readHistoryDraft = () => {
  const state: unknown = window.history.state

  if (!state || typeof state !== 'object') return ''

  const draft = (state as Record<string, unknown>).draft
  return typeof draft === 'string' ? draft : ''
}

/** 维护站内 URL 状态，并组合对应的聊天页面。 */
export function App() {
  const [summaryVisible, setSummaryVisible] = useState<boolean>()
  const [reviewThreadId, setReviewThreadId] = useState<string | null>(null)
  const [consoleSelection, setConsoleSelection] = useState<{
    sessionId: string
    executionId: string
  } | null>(null)
  const summaryTriggerRef = useRef<HTMLButtonElement>(null)
  const consoleTriggerRef = useRef<HTMLButtonElement>(null)
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
    refreshPendingApproval,
    refreshSessions,
    renameSession,
    resolveApproval,
    sendMessage,
    steerMessage,
    statuses,
    runPermissions,
    setSessionArchived,
    threads,
    trajectoryVersions,
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
    route.kind === CHAT_ROUTE_KIND.THREAD
      ? threads.find((thread) => thread.id === route.threadId)
      : undefined

  const git = useWorkspaceGit(
    selectedThread?.workspaceId,
    `${selectedThread?.id ?? ''}:${selectedThread ? (statuses[selectedThread.id] ?? '') : ''}`,
  )
  const executions = useToolExecutions(
    selectedThread?.id,
    refreshPendingApproval,
    () => {
      setConsoleSelection(null)
      if (consoleTriggerRef.current) return
      requestAnimationFrame(() =>
        summaryTriggerRef.current?.focus({ preventScroll: true }),
      )
    },
  )
  let consoleExecution = executions.executionList.find(
    (execution) =>
      execution.service &&
      execution.executionId === consoleSelection?.executionId &&
      execution.sessionId === selectedThread?.id,
  )
  // 跟随已打开服务的重启链，仍然只显示原来选中的那项服务。
  for (
    let hop = 0;
    consoleExecution && hop < executions.executionList.length;
    hop++
  ) {
    const next = executions.executionList.find(
      (execution) =>
        execution.service &&
        execution.previousExecutionId === consoleExecution?.executionId,
    )
    if (!next) break
    consoleExecution = next
  }
  const summarySections = selectedThread
    ? getSummarySections(selectedThread, git.snapshot)
    : []
  const reviewOpen = !!selectedThread && reviewThreadId === selectedThread.id
  const consoleOpen =
    !!selectedThread &&
    !!consoleExecution &&
    consoleExecution.service?.removedAt === undefined &&
    consoleSelection?.sessionId === selectedThread.id &&
    !reviewOpen
  const rightPanelOpen = reviewOpen || consoleOpen
  const workspaceLabel = workspaces.find(
    (workspace) => workspace.id === selectedThread?.workspaceId,
  )?.label

  /** 关闭审查后恢复简介入口焦点，不修改简介显隐偏好或聊天草稿。 */
  const closeReview = () => {
    setReviewThreadId(null)
    requestAnimationFrame(() =>
      summaryTriggerRef.current?.focus({ preventScroll: true }),
    )
  }

  /** 关闭当前右侧面板，并把焦点还给实际打开它的入口。 */
  const closeRightPanel = () => {
    if (reviewOpen) {
      closeReview()
      return
    }
    setConsoleSelection(null)
  }

  const activePage = useMemo<ChatActivePage>(() => {
    if (route.kind === CHAT_ROUTE_KIND.THREAD) {
      return {
        kind: CHAT_ROUTE_KIND.THREAD,
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
      if (nextRoute.kind === CHAT_ROUTE_KIND.THREAD) {
        const nextWorkspace = findWorkspaceByThreadId(
          visibleWorkspaces,
          nextRoute.threadId,
        )
        if (nextWorkspace) setSelectedWorkspaceId(nextWorkspace.id)
      }

      const method = replace ? 'replaceState' : 'pushState'
      window.history[method]({ draft: nextDraft }, '', path)
      setDraft(nextDraft)
      setReviewThreadId(null)
      setConsoleSelection(null)
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
      setReviewThreadId(null)
      setConsoleSelection(null)
      setPathname(window.location.pathname)

      const nextRoute = resolveChatRoute(window.location.pathname)
      if (nextRoute.kind === CHAT_ROUTE_KIND.THREAD) {
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
    if (route.kind === CHAT_ROUTE_KIND.THREAD) void loadThread(route.threadId)
  }, [loadThread, route])

  const handleNewChatSubmit = useCallback(
    async (payload: ChatSubmitPayload) => {
      try {
        const thread = await createSession(payload)
        setSelectedWorkspaceId(payload.workspaceId)
        const accepted = await new Promise<boolean>((resolve) => {
          void sendMessage(thread.id, payload, resolve)
        })
        if (!accepted) return false
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
      return new Promise<boolean>((resolve) => {
        void sendMessage(thread.id, payload, resolve)
      })
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
      case CHAT_ROUTE_KIND.EXPLORE:
        return <ExplorePage onNavigate={navigate} />
      case CHAT_ROUTE_KIND.LIBRARY:
        return <LibraryPage />
      case CHAT_ROUTE_KIND.THREAD:
        return (
          <ChatPage
            activePermission={runPermissions[activePage.thread.id]}
            key={activePage.thread.id}
            error={errors[activePage.thread.id]}
            isLoading={loadingIds.has(activePage.thread.id)}
            pendingApproval={pendingApprovals[activePage.thread.id]}
            status={statuses[activePage.thread.id] ?? 'ready'}
            thread={projectToolExecutions(
              activePage.thread,
              executions.executionList,
            )}
            summaryAvailable={
              !!(
                summarySections.length ||
                executions.serviceList.length ||
                git.isLoading ||
                git.error ||
                loadingIds.has(activePage.thread.id) ||
                (statuses[activePage.thread.id] === undefined &&
                  errors[activePage.thread.id])
              )
            }
            summaryVisible={rightPanelOpen ? false : summaryVisible}
            summaryTriggerRef={summaryTriggerRef}
            onSummaryVisibleChange={(visible) => {
              if (visible) {
                setReviewThreadId(null)
                setConsoleSelection(null)
              }
              setSummaryVisible(visible)
              if (visible) void git.refresh()
            }}
            summaryContent={
              <>
                <PinnedSummary
                  key={activePage.thread.id}
                  sections={summarySections}
                  workspaceId={activePage.thread.workspaceId}
                  workspaceLabel={
                    workspaces.find(
                      (workspace) =>
                        workspace.id === activePage.thread.workspaceId,
                    )?.label
                  }
                  git={git}
                  isLoading={loadingIds.has(activePage.thread.id)}
                  loadError={
                    statuses[activePage.thread.id] === undefined
                      ? errors[activePage.thread.id]
                      : undefined
                  }
                  onRetry={() => void loadThread(activePage.thread.id)}
                  onOpenChanges={() => {
                    setConsoleSelection(null)
                    setReviewThreadId(activePage.thread.id)
                    void git.refresh()
                  }}
                />
                <ServiceSummary
                  controller={executions}
                  onOpen={(execution, trigger) => {
                    consoleTriggerRef.current = trigger
                    setReviewThreadId(null)
                    setConsoleSelection({
                      sessionId: activePage.thread.id,
                      executionId: execution.executionId,
                    })
                  }}
                />
              </>
            }
            trajectoryRevision={trajectoryVersions[activePage.thread.id] ?? 0}
            onRestore={() => setSessionArchived(activePage.thread.id, false)}
            onModelChange={(selection) =>
              updateModel(activePage.thread.id, selection)
            }
            onStop={() => void abort(activePage.thread.id)}
            onSteer={(message) => steerMessage(activePage.thread.id, message)}
            onApprovalResolve={(decision) =>
              resolveApproval(activePage.thread.id, decision)
            }
            onSubmit={(payload) =>
              handleThreadSubmit(activePage.thread, payload)
            }
          />
        )
      case CHAT_ROUTE_KIND.NEW:
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
      rightPanelOpen={rightPanelOpen}
      rightPanelLabel={consoleOpen ? '服务控制台' : '变更侧栏'}
      onRightPanelClose={closeRightPanel}
      onRightPanelClosed={() => {
        const target = consoleTriggerRef.current
        if (!target) return
        // 退出动画完成后再恢复焦点，避免面板卸载把焦点重置到 body。
        requestAnimationFrame(() => {
          const visible = target.isConnected && !target.closest('[inert]')
          ;(visible ? target : summaryTriggerRef.current)?.focus({
            preventScroll: true,
          })
          consoleTriggerRef.current = null
        })
      }}
      rightPanelContent={
        consoleOpen && consoleExecution ? (
          <ToolExecutionConsole
            key={consoleExecution.executionId}
            execution={consoleExecution}
            controller={executions}
            onClose={closeRightPanel}
          />
        ) : reviewOpen && selectedThread?.workspaceId ? (
          <Suspense
            fallback={
              <div className="p-4 text-sm text-muted" role="status">
                正在加载变更视图…
              </div>
            }
          >
            <GitReviewPanel
              key={selectedThread.id}
              workspaceId={selectedThread.workspaceId}
              workspaceLabel={workspaceLabel}
              git={git}
              onClose={closeReview}
            />
          </Suspense>
        ) : null
      }
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
