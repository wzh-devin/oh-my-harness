import {
  GIT_REPOSITORY_STATE,
  PINNED_SUMMARY_SECTION_TYPE,
} from '@oh-my-harness/shared'
import type { ChatThread } from '../types/chat-types.ts'
import type { WorkspaceGitVo } from './api/workspace-git-api.ts'
import { collectSummarySources, type SummarySource } from './summary-sources.ts'
import { getTodoProgress, type TodoProgress } from './todo-progress.ts'

export type SummarySection =
  | { type: typeof PINNED_SUMMARY_SECTION_TYPE.GIT; git: WorkspaceGitVo }
  | { type: typeof PINNED_SUMMARY_SECTION_TYPE.PLAN; progress: TodoProgress }
  | {
      type: typeof PINNED_SUMMARY_SECTION_TYPE.SOURCES
      sourceList: SummarySource[]
    }

/** 只有事实存在时生成对应类型；空标题和空态不构成简介内容。 */
export const getSummarySections = (
  thread: ChatThread,
  git?: WorkspaceGitVo,
): SummarySection[] => {
  const sectionList: SummarySection[] = []
  if (git && git.state !== GIT_REPOSITORY_STATE.NOT_REPOSITORY)
    sectionList.push({ type: PINNED_SUMMARY_SECTION_TYPE.GIT, git })
  if (thread.todos?.length)
    sectionList.push({
      type: PINNED_SUMMARY_SECTION_TYPE.PLAN,
      progress: getTodoProgress(thread.todos),
    })
  const sourceList = collectSummarySources(thread.messages)
  if (sourceList.length)
    sectionList.push({ type: PINNED_SUMMARY_SECTION_TYPE.SOURCES, sourceList })
  return sectionList
}
