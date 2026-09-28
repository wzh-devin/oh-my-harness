import { useId, useState } from 'react'
import { Button } from '@heroui/react'
import { LogoGithub } from '@gravity-ui/icons'
import {
  GIT_ACTION,
  GIT_REPOSITORY_STATE,
  PINNED_SUMMARY_SECTION_TYPE,
  type GitAction,
} from '@oh-my-harness/shared'
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  FileDiffIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  ImageIcon,
  LightbulbIcon,
  LinkIcon,
  RefreshCwIcon,
} from 'lucide-react'
import type { SummarySection } from '../summary-sections.ts'
import type { WorkspaceGitController } from '../use-workspace-git.ts'
import { GitActionDialog } from './GitActionDialog.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../components/ui/collapsible.tsx'

interface PinnedSummaryProps {
  sections: SummarySection[]
  workspaceId?: string | null
  workspaceLabel?: string
  git: WorkspaceGitController
  isLoading: boolean
  loadError?: string
  onRetry: () => void
  onOpenChanges: () => void
}

/** 按事实枚举组合 Git、计划与来源；缺失内容不会产生标题、占位或分隔线。 */
export function PinnedSummary({
  sections,
  workspaceId,
  workspaceLabel,
  git,
  isLoading,
  loadError,
  onRetry,
  onOpenChanges,
}: PinnedSummaryProps) {
  const id = useId()
  const [showAllSources, setShowAllSources] = useState(false)
  const [view, setView] = useState<GitAction | null>(null)
  return (
    <>
      {sections.map((section) => {
        if (section.type === PINNED_SUMMARY_SECTION_TYPE.GIT) {
          const snapshot = section.git
          return (
            <section
              className="summary-section"
              aria-labelledby={`${id}-git`}
              key={section.type}
            >
              <div className="summary-group-heading">
                <h2
                  className="summary-heading"
                  id={`${id}-git`}
                  title={workspaceLabel}
                >
                  {workspaceLabel ?? 'Git'}
                </h2>
                <Button
                  aria-label="刷新 Git 状态"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="summary-refresh"
                  isDisabled={git.isLoading || git.isPending}
                  onPress={() => void git.refresh()}
                >
                  <RefreshCwIcon className="size-3.5" />
                </Button>
              </div>
              <button
                className="summary-row summary-action"
                type="button"
                onClick={onOpenChanges}
              >
                <FileDiffIcon aria-hidden="true" />
                <span>变更</span>
                <span className="ml-auto summary-secondary">
                  {snapshot.files.length
                    ? `${snapshot.files.length} 个文件`
                    : '无变更'}
                </span>
                {snapshot.additions || snapshot.deletions ? (
                  <span
                    className="shrink-0"
                    title="已暂存与未暂存的跟踪文件行数合计"
                  >
                    <span className="text-success">+{snapshot.additions}</span>{' '}
                    <span className="text-danger">−{snapshot.deletions}</span>
                  </span>
                ) : null}
              </button>
              <button
                className="summary-row summary-action"
                type="button"
                disabled={!snapshot.actions.includes(GIT_ACTION.SWITCH_BRANCH)}
                title={
                  !snapshot.actions.includes(GIT_ACTION.SWITCH_BRANCH)
                    ? '需要干净工作区和其他本地分支才能切换'
                    : '切换分支'
                }
                onClick={() => setView(GIT_ACTION.SWITCH_BRANCH)}
              >
                <GitBranchIcon aria-hidden="true" />
                <span className="truncate">
                  {snapshot.branch ??
                    `HEAD ${snapshot.head?.slice(0, 7) ?? ''}`}
                </span>
                {snapshot.actions.includes(GIT_ACTION.SWITCH_BRANCH) ? (
                  <ChevronDownIcon className="ml-auto" aria-hidden="true" />
                ) : null}
              </button>
              {snapshot.actions.includes(GIT_ACTION.COMMIT) ? (
                <button
                  className="summary-row summary-action"
                  type="button"
                  onClick={() => setView(GIT_ACTION.COMMIT)}
                >
                  <GitCommitHorizontalIcon aria-hidden="true" />
                  提交已暂存内容
                </button>
              ) : null}
              {snapshot.actions.includes(GIT_ACTION.PUSH) ? (
                <button
                  className="summary-row summary-action"
                  type="button"
                  onClick={() => setView(GIT_ACTION.PUSH)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                  推送
                  <span className="ml-auto summary-secondary">
                    {snapshot.ahead} 个提交
                  </span>
                </button>
              ) : null}
              {snapshot.compareUrl ? (
                <a
                  className="summary-row summary-action"
                  href={snapshot.compareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LogoGithub aria-hidden="true" />
                  比较分支
                  <ArrowUpRightIcon
                    className="ml-auto text-muted"
                    aria-hidden="true"
                  />
                </a>
              ) : (
                <div className="summary-row text-muted" aria-disabled="true">
                  <LogoGithub aria-hidden="true" />
                  无法获取 Pull Request 状态
                </div>
              )}
              {snapshot.state === GIT_REPOSITORY_STATE.CONFLICTED ||
              snapshot.operationInProgress ||
              snapshot.behind > 0 ? (
                <p className="summary-empty">
                  {snapshot.state === GIT_REPOSITORY_STATE.CONFLICTED
                    ? '存在合并冲突，请先在本地解决。'
                    : snapshot.operationInProgress
                      ? '有进行中的 Git 操作，请先在本地完成。'
                      : `落后上游 ${snapshot.behind} 个提交`}
                </p>
              ) : null}
            </section>
          )
        }
        if (section.type === PINNED_SUMMARY_SECTION_TYPE.PLAN)
          return (
            <section
              className="summary-section"
              aria-labelledby={`${id}-plan`}
              key={section.type}
            >
              <h2 className="summary-heading" id={`${id}-plan`}>
                计划
              </h2>
              <div className="summary-row summary-detail">
                {section.progress.completed === section.progress.total ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <LightbulbIcon aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p
                    className="line-clamp-2 break-words"
                    title={section.progress.description}
                  >
                    {section.progress.description}
                  </p>
                  <p className="summary-secondary">
                    {section.progress.total} 个步骤 · 已完成{' '}
                    {section.progress.completed}/{section.progress.total}
                  </p>
                </div>
              </div>
            </section>
          )
        const sourceItems = section.sourceList.map((source) => (
          <li className="summary-row" key={source.id} title={source.title}>
            {source.mimeType?.startsWith('image/') ? (
              <ImageIcon aria-hidden="true" />
            ) : (
              <FileIcon aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{source.title}</span>
          </li>
        ))
        return (
          <Collapsible
            render={<section />}
            open={showAllSources}
            onOpenChange={setShowAllSources}
            className="summary-section"
            aria-labelledby={`${id}-sources`}
            key={section.type}
          >
            <h2 className="summary-heading" id={`${id}-sources`}>
              来源
            </h2>
            <ul>{sourceItems.slice(0, 3)}</ul>
            <CollapsibleContent
              id={`${id}-source-list`}
              inert={!showAllSources}
            >
              <ul>{sourceItems.slice(3)}</ul>
            </CollapsibleContent>
            {section.sourceList.length > 3 ? (
              <CollapsibleTrigger
                aria-controls={`${id}-source-list`}
                aria-expanded={showAllSources}
                className="summary-row summary-more"
                type="button"
              >
                <LinkIcon aria-hidden="true" />
                {showAllSources
                  ? '收起来源'
                  : `查看全部 ${section.sourceList.length} 项`}
              </CollapsibleTrigger>
            ) : null}
          </Collapsible>
        )
      })}
      {(isLoading || git.isLoading) && !sections.length ? (
        <div
          aria-label="正在加载简介"
          className="summary-skeleton"
          role="status"
        >
          <span />
          <span />
        </div>
      ) : null}
      {loadError || git.error ? (
        <div className="summary-load-error" role="status">
          <span>{git.error ?? '会话简介加载失败'}</span>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={git.isPending}
            onPress={git.error ? () => void git.refresh() : onRetry}
          >
            重试
          </Button>
        </div>
      ) : null}
      {view && workspaceId && git.snapshot ? (
        <GitActionDialog
          view={view}
          snapshot={git.snapshot}
          controller={git}
          onClose={() => setView(null)}
        />
      ) : null}
    </>
  )
}
