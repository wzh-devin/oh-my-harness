import type {
  GitAction,
  GitFileStatus,
  GitRepositoryState,
} from '@oh-my-harness/shared'

export interface GitFileVo {
  path: string
  originalPath?: string
  indexStatus: GitFileStatus
  worktreeStatus: GitFileStatus
  conflicted: boolean
}
export interface WorkspaceGitVo {
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
  files: GitFileVo[]
  branches: { ref: string; name: string; local: boolean }[]
  actions: GitAction[]
}
export interface GitActionInput {
  action: GitAction
  revision: string
  path?: string
  branch?: string
  message?: string
}

/** Git 请求统一绑定注册工作区；异常文案由服务端安全映射。 */
const request = async <T>(
  workspaceId: string,
  suffix = '',
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/git${suffix}`,
    {
      ...init,
      headers: {
        'x-oh-my-harness-request': 'workspace-git',
        'content-type': 'application/json',
      },
    },
  )
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Git 请求失败，请重试。')
  return body as T
}

/** 读取当前工作区 Git 快照，支持取消过期查询。 */
export const readWorkspaceGit = (id: string, signal?: AbortSignal) =>
  request<WorkspaceGitVo>(id, '', { signal })

/** 读取选中文件或分支的只读差异。 */
export const readGitDiff = (
  id: string,
  input: { path?: string; base?: string; staged?: boolean },
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams()
  if (input.path) query.set('path', input.path)
  if (input.base) query.set('base', input.base)
  if (input.staged !== undefined) query.set('staged', String(input.staged))
  return request<{ content: string }>(id, `/diff?${query}`, { signal })
}

/** 执行经用户确认的 Git 动作，提交不隐式推送。 */
export const performGitAction = (id: string, input: GitActionInput) =>
  request<WorkspaceGitVo>(id, '/actions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
