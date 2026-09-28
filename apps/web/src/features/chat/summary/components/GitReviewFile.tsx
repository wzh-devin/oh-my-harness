import { useId, useState } from 'react'
import { Button } from '@heroui/react'
import { FileDiff, type FileDiffOptions } from '@pierre/diffs/react'
import { ChevronDownIcon } from 'lucide-react'
import { GIT_ACTION, GIT_FILE_STATUS } from '@oh-my-harness/shared'
import type { GitFileVo } from '../api/workspace-git-api.ts'
import type { WorkspaceGitController } from '../use-workspace-git.ts'
import { FileReferenceIcon } from '../../workspace/index.ts'
import { getGitDiffStats, getGitFileLabel } from '../git-review-files.ts'
import { useGitDiff } from '../use-git-diff.ts'
import {
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../components/ui/collapsible.tsx'

const getEmptyMessage = (
  diff: ReturnType<typeof useGitDiff>,
  active: boolean,
) => {
  if (!active || diff.loading) return '正在读取差异…'
  if (diff.error) return `差异加载失败：${diff.error}`
  return diff.notice
}

/** 连续审查中的单个文件；差异层、重试和暂存动作始终绑定本文件。 */
export function GitReviewFile({
  workspaceId,
  file,
  collapsed,
  active,
  refreshVersion,
  git,
  options,
}: {
  workspaceId: string
  file: GitFileVo
  collapsed: boolean
  active: boolean
  refreshVersion: number
  git: WorkspaceGitController
  options: FileDiffOptions<undefined, undefined>
}) {
  const contentId = useId()
  const [staged, setStaged] = useState(false)
  const [retry, setRetry] = useState(0)
  const snapshot = git.snapshot
  const hasStaged =
    file.indexStatus !== GIT_FILE_STATUS.UNMODIFIED &&
    file.indexStatus !== GIT_FILE_STATUS.UNTRACKED
  const hasUnstaged = file.worktreeStatus !== GIT_FILE_STATUS.UNMODIFIED
  const showStaged = hasStaged && (staged || !hasUnstaged)
  const diff = useGitDiff(
    workspaceId,
    active ? file.path : undefined,
    showStaged,
    snapshot?.revision ?? '',
    refreshVersion + retry,
  )
  const status = getGitFileLabel(file)
  const stats = getGitDiffStats(diff.items)
  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  const directory = file.path.slice(0, file.path.length - name.length)
  const action = showStaged ? GIT_ACTION.UNSTAGE : GIT_ACTION.STAGE
  const emptyRole = active ? (diff.error ? 'alert' : 'status') : undefined

  return (
    <>
      <div className="git-review-filebar">
        <CollapsibleTrigger
          type="button"
          className="git-review-file-toggle"
          aria-label={`${collapsed ? '展开' : '折叠'} ${file.path}`}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          title={`${file.path} · ${status.label}`}
        >
          <ChevronDownIcon className="git-review-chevron size-3.5 shrink-0" />
          <FileReferenceIcon
            label={name.split('.').pop()?.toUpperCase() ?? 'FILE'}
          />
          <span className="git-review-file-path">
            {directory ? (
              <span className="git-review-file-directory">{directory}</span>
            ) : null}
            <span className="git-review-file-name">{name}</span>
          </span>
        </CollapsibleTrigger>
        {diff.items.length ? (
          <span
            className="git-review-stats"
            aria-label={`新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
          >
            <span className="text-success">+{stats.additions}</span>
            <span className="text-danger">−{stats.deletions}</span>
          </span>
        ) : null}
        {hasStaged && hasUnstaged ? (
          <select
            aria-label={`${file.path} 差异暂存层`}
            value={showStaged ? 'staged' : 'worktree'}
            onChange={(event) => setStaged(event.target.value === 'staged')}
          >
            <option value="worktree">未暂存</option>
            <option value="staged">已暂存</option>
          </select>
        ) : null}
        {snapshot?.actions.includes(action) ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${showStaged ? '取消暂存' : '暂存文件'} ${file.path}`}
            isDisabled={git.isPending || git.isLoading}
            onPress={() =>
              void git.perform({
                action,
                revision: snapshot.revision,
                path: file.path,
              })
            }
          >
            {showStaged ? '取消暂存' : '暂存'}
          </Button>
        ) : null}
      </div>
      <CollapsibleContent
        id={contentId}
        className="git-review-file-content"
        inert={collapsed}
      >
        {diff.items.length ? (
          diff.items.map((item) => (
            <FileDiff
              key={item.id}
              fileDiff={item.fileDiff}
              options={options}
              metrics={{
                hunkLineCount: 50,
                lineHeight: 20,
                diffHeaderHeight: 0,
                spacing: 0,
                paddingTop: 0,
                paddingBottom: 0,
              }}
            />
          ))
        ) : (
          <div className="git-review-empty" role={emptyRole}>
            <span className="break-all">{file.path}</span>
            <span>{getEmptyMessage(diff, active)}</span>
            {diff.error ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setRetry((value) => value + 1)}
              >
                重试
              </Button>
            ) : null}
          </div>
        )}
      </CollapsibleContent>
    </>
  )
}
