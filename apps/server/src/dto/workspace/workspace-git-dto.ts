import type {
  GitAction,
  GitFileStatus,
  GitRepositoryState,
} from '@oh-my-harness/shared'

export interface GitFileDto {
  path: string
  originalPath?: string
  indexStatus: GitFileStatus
  worktreeStatus: GitFileStatus
  conflicted: boolean
}

export interface WorkspaceGitDto {
  state: GitRepositoryState
  revision: string
  branch: string | null
  head: string | null
  upstream: string | null
  compareUrl: string | null
  ahead: number
  behind: number
  additions: number
  deletions: number
  operationInProgress: boolean
  files: GitFileDto[]
  branches: { ref: string; name: string; local: boolean }[]
  actions: GitAction[]
}

export interface GitActionDto {
  action: GitAction
  revision: string
  path?: string
  branch?: string
  message?: string
}

export interface GitDiffDto {
  content: string
}
