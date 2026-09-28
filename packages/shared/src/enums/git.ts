export const PINNED_SUMMARY_SECTION_TYPE = {
  GIT: 'git',
  PLAN: 'plan',
  SOURCES: 'sources',
} as const
export type PinnedSummarySectionType =
  (typeof PINNED_SUMMARY_SECTION_TYPE)[keyof typeof PINNED_SUMMARY_SECTION_TYPE]

export const GIT_REPOSITORY_STATE = {
  NOT_REPOSITORY: 'not_repository',
  CLEAN: 'clean',
  DIRTY: 'dirty',
  CONFLICTED: 'conflicted',
} as const
export type GitRepositoryState =
  (typeof GIT_REPOSITORY_STATE)[keyof typeof GIT_REPOSITORY_STATE]

export const GIT_FILE_STATUS = {
  UNMODIFIED: ' ',
  MODIFIED: 'M',
  ADDED: 'A',
  DELETED: 'D',
  RENAMED: 'R',
  COPIED: 'C',
  UNMERGED: 'U',
  UNTRACKED: '?',
  TYPE_CHANGED: 'T',
} as const
export type GitFileStatus =
  (typeof GIT_FILE_STATUS)[keyof typeof GIT_FILE_STATUS]

export const GIT_ACTION = {
  VIEW_CHANGES: 'view_changes',
  SWITCH_BRANCH: 'switch_branch',
  STAGE: 'stage',
  UNSTAGE: 'unstage',
  COMMIT: 'commit',
  PUSH: 'push',
  COMPARE_BRANCH: 'compare_branch',
} as const
export type GitAction = (typeof GIT_ACTION)[keyof typeof GIT_ACTION]

export const GIT_ERROR_CODE = {
  INVALID_REQUEST: 'GIT_INVALID_REQUEST',
  REQUEST_REJECTED: 'GIT_REQUEST_REJECTED',
  UNAVAILABLE: 'GIT_UNAVAILABLE',
  STALE_STATE: 'GIT_STALE_STATE',
  ACTION_UNAVAILABLE: 'GIT_ACTION_UNAVAILABLE',
  LIMIT_EXCEEDED: 'GIT_LIMIT_EXCEEDED',
} as const
