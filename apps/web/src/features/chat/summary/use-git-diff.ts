import { useEffect, useState } from 'react'
import { parsePatchFiles, type CodeViewDiffItem } from '@pierre/diffs'
import { readGitDiff } from './api/workspace-git-api.ts'

export const getGitDiffNotice = (content: string) => {
  if (!content) return '此文件在当前暂存层没有文本差异。'
  if (content.includes('Binary files '))
    return '二进制文件已变化，无法显示文本行差异。'
  if (content.startsWith('diff --git '))
    return '文件元数据已变化，没有文本行差异。'
  return content
}

/** 按工作区、文件和暂存层隔离差异，切换时立即丢弃旧结果并取消读取。 */
export const useGitDiff = (
  workspaceId: string,
  path: string | undefined,
  staged: boolean,
  revision: string,
  retry: number,
) => {
  const requestKey = JSON.stringify([
    workspaceId,
    path,
    staged,
    revision,
    retry,
  ])
  const [state, setState] = useState<{
    key: string
    items: CodeViewDiffItem[]
    notice?: string
    error?: string
  }>()
  useEffect(() => {
    if (!path) return
    const request = new AbortController()
    void readGitDiff(workspaceId, { path, staged }, request.signal)
      .then(({ content }) => {
        if (request.signal.aborted) return
        const items = content.startsWith('diff --git ')
          ? parsePatchFiles(content, requestKey, true)
              .flatMap((patch) => patch.files)
              .map((fileDiff, index) => ({
                id: `${path}:${index}`,
                type: 'diff' as const,
                fileDiff,
              }))
          : []
        const hasLines = items.some((item) => item.fileDiff.hunks.length > 0)
        setState({
          key: requestKey,
          items: hasLines ? items : [],
          notice: hasLines ? undefined : getGitDiffNotice(content),
        })
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted)
          setState({
            key: requestKey,
            items: [],
            error:
              error instanceof Error ? error.message : '差异读取失败，请重试。',
          })
      })
    return () => request.abort()
  }, [workspaceId, path, staged, revision, retry, requestKey])
  return state?.key === requestKey
    ? { ...state, loading: false }
    : { items: [], loading: !!path, error: undefined, notice: undefined }
}
