import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHAT_ROUTE_KIND,
  PLUGIN_SETTINGS_TAB,
  SETTINGS_SECTION,
  type SettingsSection,
} from '@oh-my-harness/shared'
import { AppLayout } from '@agile-avocation/ui-pro/app-layout'
import '../styles/ChatLayout.css'
import {
  type ChatActivePage,
  ChatNavbar,
  ChatSearchDialog,
  ChatSidebar,
  type ChatThread,
  ChatWorkspaceContext,
  type ChatWorkspace,
  FileEditorOpenDialog,
  type FileEditorSelectionVo,
  openWorkspaceFile,
  selectFileEditor,
  WorkspaceApiError,
} from '../features/chat/index.ts'
import {
  type PluginSettingsTab,
  SettingsDialog,
  SettingsProvider,
} from '../features/settings/index.ts'

interface ChatLayoutProps {
  activePage: ChatActivePage
  children: ReactNode
  isWorkspaceLoading: boolean
  onArchivedConversationDelete: (threadId: string) => Promise<string>
  onArchivedConversationsClear: () => Promise<string>
  onNavigate: (path: string, draft?: string) => void
  onThreadArchive: (threadId: string, archived: boolean) => Promise<string>
  onThreadRename: (threadId: string, name: string) => Promise<string>
  onWorkspaceAdd: () => Promise<ChatWorkspace | null>
  onWorkspaceArchiveAll: (workspaceId: string) => Promise<string>
  onWorkspaceDelete: (workspaceId: string) => Promise<string>
  onWorkspaceSelect: (workspaceId: string) => void
  selectedWorkspaceId: string
  archivedThreads: readonly ChatThread[]
  threads: readonly ChatThread[]
  workspaces: readonly ChatWorkspace[]
  workspaceError: string
}

interface FileEditorDialogState {
  editor?: FileEditorSelectionVo
  error?: string
  path: string
  workspaceId: string
}

const requiresEditorSelection = (error: unknown) =>
  error instanceof WorkspaceApiError &&
  (error.code === 'FILE_EDITOR_REQUIRED' ||
    error.code === 'FILE_EDITOR_UNAVAILABLE')

const getFileEditorError = (error: unknown) =>
  error instanceof Error ? error.message : '无法打开该文件。'

/** 组合聊天应用外壳，并统一管理搜索弹窗与全局快捷键。 */
export function ChatLayout({
  activePage,
  archivedThreads,
  children,
  isWorkspaceLoading,
  onArchivedConversationDelete,
  onArchivedConversationsClear,
  onNavigate,
  onThreadArchive,
  onThreadRename,
  onWorkspaceAdd,
  onWorkspaceArchiveAll,
  onWorkspaceDelete,
  onWorkspaceSelect,
  selectedWorkspaceId,
  threads,
  workspaces,
  workspaceError,
}: ChatLayoutProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [fileEditorDialog, setFileEditorDialog] =
    useState<FileEditorDialogState>()
  const [isFileEditorPending, setIsFileEditorPending] = useState(false)
  const fileEditorRequestId = useRef(0)
  const isFileEditorBusy = useRef(false)
  const [settingsTarget, setSettingsTarget] = useState<{
    pluginTab: PluginSettingsTab
    section: SettingsSection
  }>({
    pluginTab: PLUGIN_SETTINGS_TAB.SKILLS,
    section: SETTINGS_SECTION.GENERAL,
  })
  const isThreadPage = activePage.kind === CHAT_ROUTE_KIND.THREAD
  const activePageId = isThreadPage ? activePage.thread.id : activePage.kind
  const activeWorkspaceId = isThreadPage
    ? activePage.thread.workspaceId
    : undefined

  const openPluginSettings = useCallback((pluginTab: PluginSettingsTab) => {
    setSettingsTarget({ pluginTab, section: SETTINGS_SECTION.PLUGINS })
    setIsSettingsOpen(true)
  }, [])

  const handleThreadSelect = useCallback(
    (thread: ChatThread) => {
      setIsSearchOpen(false)
      onNavigate(`/${thread.id}`)
    },
    [onNavigate],
  )

  const chooseFileEditor = useCallback(
    async (
      target: Pick<FileEditorDialogState, 'path' | 'workspaceId'>,
      requestId: number,
    ) => {
      try {
        const editor = await selectFileEditor()
        if (requestId !== fileEditorRequestId.current || !editor) return
        setFileEditorDialog({ ...target, editor })
      } catch (error) {
        if (requestId !== fileEditorRequestId.current) return
        setFileEditorDialog({ ...target, error: getFileEditorError(error) })
      }
    },
    [],
  )

  const handleFileOpen = useCallback(
    (path: string) => {
      if (!activeWorkspaceId || isFileEditorBusy.current) return
      const target = { path, workspaceId: activeWorkspaceId }
      const requestId = ++fileEditorRequestId.current
      isFileEditorBusy.current = true
      setFileEditorDialog(undefined)
      setIsFileEditorPending(true)
      void openWorkspaceFile(activeWorkspaceId, path)
        .catch(async (error: unknown) => {
          if (requestId !== fileEditorRequestId.current) return
          if (requiresEditorSelection(error)) {
            await chooseFileEditor(target, requestId)
            return
          }
          setFileEditorDialog({ ...target, error: getFileEditorError(error) })
        })
        .finally(() => {
          isFileEditorBusy.current = false
          if (requestId === fileEditorRequestId.current) {
            setIsFileEditorPending(false)
          }
        })
    },
    [activeWorkspaceId, chooseFileEditor],
  )

  const handleEditorReselect = useCallback(() => {
    if (!fileEditorDialog || isFileEditorBusy.current) return
    const target = {
      path: fileEditorDialog.path,
      workspaceId: fileEditorDialog.workspaceId,
    }
    const requestId = ++fileEditorRequestId.current
    isFileEditorBusy.current = true
    setIsFileEditorPending(true)
    void chooseFileEditor(target, requestId).finally(() => {
      isFileEditorBusy.current = false
      if (requestId === fileEditorRequestId.current) {
        setIsFileEditorPending(false)
      }
    })
  }, [chooseFileEditor, fileEditorDialog])

  const handleEditorOpen = useCallback(
    (remember: boolean) => {
      if (!fileEditorDialog?.editor || isFileEditorBusy.current) return
      const editor = fileEditorDialog.editor
      const requestId = ++fileEditorRequestId.current
      isFileEditorBusy.current = true
      const currentDialog = fileEditorDialog
      setIsFileEditorPending(true)
      setFileEditorDialog({ ...currentDialog, error: undefined })
      void openWorkspaceFile(currentDialog.workspaceId, currentDialog.path, {
        remember,
        selectionId: editor.selectionId,
      })
        .then(() => {
          if (requestId === fileEditorRequestId.current) {
            setFileEditorDialog(undefined)
          }
        })
        .catch((error: unknown) => {
          if (requestId !== fileEditorRequestId.current) return
          setFileEditorDialog({
            ...currentDialog,
            error: getFileEditorError(error),
          })
        })
        .finally(() => {
          isFileEditorBusy.current = false
          if (requestId === fileEditorRequestId.current) {
            setIsFileEditorPending(false)
          }
        })
    },
    [fileEditorDialog],
  )

  const handleEditorDialogClose = useCallback(() => {
    fileEditorRequestId.current += 1
    setIsFileEditorPending(false)
    setFileEditorDialog(undefined)
  }, [])

  useEffect(() => {
    fileEditorRequestId.current += 1
    // oxlint-disable-next-line react/set-state-in-effect -- Thread 变化必须清除上一个工作区的本地打开选择。
    setFileEditorDialog(undefined)
    setIsFileEditorPending(false)
  }, [activePageId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
      const metaPressed = isMac ? event.metaKey : event.ctrlKey

      if (metaPressed && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsSearchOpen((open) => !open)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <SettingsProvider
      permissionScope={`${activePageId}:${activeWorkspaceId ?? selectedWorkspaceId}`}
      selectedWorkspaceId={selectedWorkspaceId}
      onOpenPluginSettings={openPluginSettings}
    >
      <ChatWorkspaceContext.Provider
        value={{
          onFileOpen: activeWorkspaceId ? handleFileOpen : undefined,
          onWorkspaceSelect,
          selectedWorkspaceId,
          workspaces,
        }}
      >
        <AppLayout
          className={isThreadPage ? 'chat-layout--thread' : undefined}
          key={isThreadPage ? 'thread-layout' : 'standard-layout'}
          navigate={onNavigate}
          sidebarCollapsible="icon"
          navbar={
            <ChatNavbar
              activePage={activePage}
              onSearch={() => setIsSearchOpen(true)}
            />
          }
          sidebar={
            <ChatSidebar
              activePage={activePage}
              isWorkspaceLoading={isWorkspaceLoading}
              selectedWorkspaceId={selectedWorkspaceId}
              workspaces={workspaces}
              workspaceError={workspaceError}
              onSearch={() => setIsSearchOpen(true)}
              onThreadArchive={(threadId) => onThreadArchive(threadId, true)}
              onThreadRename={onThreadRename}
              onSettings={() => {
                setSettingsTarget((currentTarget) => ({
                  ...currentTarget,
                  section: SETTINGS_SECTION.GENERAL,
                }))
                setIsSettingsOpen(true)
              }}
              onWorkspaceAdd={onWorkspaceAdd}
              onWorkspaceArchiveAll={onWorkspaceArchiveAll}
              onWorkspaceDelete={onWorkspaceDelete}
              onWorkspaceNewChat={(workspaceId) => {
                onWorkspaceSelect(workspaceId)
                onNavigate('/new')
              }}
              onWorkspaceSelect={onWorkspaceSelect}
              threads={threads}
            />
          }
        >
          {children}
          <ChatSearchDialog
            isOpen={isSearchOpen}
            threads={threads}
            onOpenChange={setIsSearchOpen}
            onSelect={handleThreadSelect}
          />
          {fileEditorDialog ? (
            <FileEditorOpenDialog
              editor={fileEditorDialog.editor}
              error={fileEditorDialog.error}
              isPending={isFileEditorPending}
              path={fileEditorDialog.path}
              onClose={handleEditorDialogClose}
              onOpen={handleEditorOpen}
              onReselect={handleEditorReselect}
            />
          ) : null}
          <SettingsDialog
            archivedConversations={archivedThreads.map((thread) => ({
              id: thread.id,
              title: thread.title,
              updatedAt: thread.updatedAt,
              workspaceLabel:
                workspaces.find(
                  (workspace) => workspace.id === thread.workspaceId,
                )?.label ?? '未知工作区',
            }))}
            key={`${settingsTarget.section}-${settingsTarget.pluginTab}-${isSettingsOpen ? 'open' : 'closed'}`}
            initialPluginTab={settingsTarget.pluginTab}
            initialSection={settingsTarget.section}
            isOpen={isSettingsOpen}
            onArchivedConversationDelete={onArchivedConversationDelete}
            onArchivedConversationRestore={(threadId) =>
              onThreadArchive(threadId, false)
            }
            onArchivedConversationsClear={onArchivedConversationsClear}
            onArchivedConversationView={(threadId) => {
              setIsSettingsOpen(false)
              onNavigate(`/${threadId}`)
            }}
            onOpenChange={setIsSettingsOpen}
          />
        </AppLayout>
      </ChatWorkspaceContext.Provider>
    </SettingsProvider>
  )
}
