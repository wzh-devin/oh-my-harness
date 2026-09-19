import type { ChatActivePage, ChatThread } from '../../../types/chat-types.ts'
import type { ChatWorkspace } from '../../../workspace/data/workspace-data.ts'

export interface ChatSidebarProps {
  activePage: ChatActivePage
  isWorkspaceLoading: boolean
  onThreadArchive: (threadId: string) => Promise<string>
  onThreadRename: (threadId: string, name: string) => Promise<string>
  onWorkspaceAdd: () => Promise<ChatWorkspace | null>
  onWorkspaceArchiveAll: (workspaceId: string) => Promise<string>
  onWorkspaceDelete: (workspaceId: string) => Promise<string>
  onWorkspaceNewChat: (workspaceId: string) => void
  onWorkspaceSelect: (workspaceId: string) => void
  onSearch: () => void
  onSettings: () => void
  selectedWorkspaceId: string
  threads: readonly ChatThread[]
  workspaces: readonly ChatWorkspace[]
  workspaceError: string
}
