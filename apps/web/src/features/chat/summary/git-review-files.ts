import { GIT_FILE_STATUS } from '@oh-my-harness/shared'
import type { GitFileVo } from './api/workspace-git-api.ts'
import type { CodeViewDiffItem } from '@pierre/diffs'

/** 只累计 patch 中实际增删行，排除上下文行。 */
export const getGitDiffStats = (items: CodeViewDiffItem[]) => {
  let additions = 0
  let deletions = 0
  for (const { fileDiff } of items)
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines
      deletions += hunk.deletionLines
    }
  return { additions, deletions }
}

export interface GitReviewTreeNode {
  id: string
  name: string
  file?: GitFileVo
  children: GitReviewTreeNode[]
}

/** 将真实变更路径组织成目录树；过滤时保留命中文件的父目录。 */
export const buildGitReviewTree = (files: GitFileVo[], query = '') => {
  const roots: GitReviewTreeNode[] = []
  const nodeMap = new Map<string, GitReviewTreeNode>()
  const search = query.trim().toLocaleLowerCase()
  for (const file of files) {
    if (!file.path.toLocaleLowerCase().includes(search)) continue
    const segments = file.path.split('/')
    let children = roots
    for (let index = 0; index < segments.length; index++) {
      const path = segments.slice(0, index + 1).join('/')
      const isFile = index === segments.length - 1
      const id = `${isFile ? 'file' : 'dir'}:${path}`
      let node = nodeMap.get(id)
      if (!node) {
        node = {
          id,
          name: segments[index],
          children: [],
          ...(isFile ? { file } : {}),
        }
        nodeMap.set(id, node)
        children.push(node)
      }
      children = node.children
    }
  }
  const expandedKeys: string[] = []
  // 单链目录压成一行，让较窄文件树仍能读到文件名。
  const compact = (nodes: GitReviewTreeNode[]): GitReviewTreeNode[] =>
    nodes.map((initial) => {
      let node = initial
      while (
        !node.file &&
        node.children.length === 1 &&
        !node.children[0].file
      ) {
        const child = node.children[0]
        node = { ...child, name: `${node.name}/${child.name}` }
      }
      if (!node.file) expandedKeys.push(node.id)
      return { ...node, children: compact(node.children) }
    })
  return { roots: compact(roots), expandedKeys }
}

/** 把 Git 两列状态压缩为文件树徽标，完整语义保留在可访问名称。 */
export const getGitFileLabel = (file: GitFileVo) => {
  if (file.conflicted) return { badge: 'U', label: '冲突', tone: 'text-danger' }
  const status =
    file.indexStatus === GIT_FILE_STATUS.UNMODIFIED
      ? file.worktreeStatus
      : file.indexStatus
  if (status === GIT_FILE_STATUS.UNTRACKED)
    return { badge: 'U', label: '未跟踪', tone: 'text-success' }
  if (status === GIT_FILE_STATUS.ADDED)
    return { badge: 'A', label: '新增', tone: 'text-success' }
  if (status === GIT_FILE_STATUS.DELETED)
    return { badge: 'D', label: '删除', tone: 'text-danger' }
  if (status === GIT_FILE_STATUS.RENAMED)
    return { badge: 'R', label: '重命名', tone: 'text-muted' }
  return { badge: status, label: '已修改', tone: 'text-muted' }
}
