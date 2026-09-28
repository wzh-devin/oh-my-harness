import type { Context } from 'hono'
import {
  GIT_ACTION,
  GIT_ERROR_CODE,
  type GitAction,
} from '@oh-my-harness/shared'
import type { WorkspaceGitService } from '../../infrastructure/workspace/workspace-git-service.ts'
import { WorkspaceError } from '../../infrastructure/workspace/workspace-store.ts'

const writeActionFields = new Map<GitAction, string[]>([
  [GIT_ACTION.STAGE, ['path']],
  [GIT_ACTION.UNSTAGE, ['path']],
  [GIT_ACTION.SWITCH_BRANCH, ['branch']],
  [GIT_ACTION.COMMIT, ['message']],
  [GIT_ACTION.PUSH, []],
])

/** 工作区 Git 的 HTTP 边界：拒绝额外参数和非枚举写动作，隐藏底层异常。 */
export const createWorkspaceGitController = (git: WorkspaceGitService) => {
  const protect =
    (operation: (context: Context, id: string) => Promise<unknown>) =>
    async (context: Context) => {
      try {
        const id = context.req.param('workspaceId')
        if (!id || id.length > 200)
          throw new WorkspaceError(
            GIT_ERROR_CODE.INVALID_REQUEST,
            '工作区 ID 无效。',
            400,
          )
        return context.json(await operation(context, id))
      } catch (error) {
        return context.json(
          error instanceof WorkspaceError
            ? { code: error.code, message: error.message }
            : {
                code: GIT_ERROR_CODE.UNAVAILABLE,
                message: 'Git 请求失败，请重试。',
              },
          error instanceof WorkspaceError ? error.status : 500,
        )
      }
    }
  return {
    snapshot: protect((_context, id) => git.snapshot(id)),
    diff: protect((context, id) => {
      const { path, base, staged, ...rest } = context.req.query()
      if (
        Object.keys(rest).length ||
        !!path === !!base ||
        (path?.length ?? 0) > 4096 ||
        (base?.length ?? 0) > 1024 ||
        (staged !== undefined && staged !== 'true' && staged !== 'false')
      ) {
        throw new WorkspaceError(
          GIT_ERROR_CODE.INVALID_REQUEST,
          '差异查询参数无效。',
          400,
        )
      }
      return git.diff(id, { path, base, staged: staged === 'true' })
    }),
    act: protect(async (context, id) => {
      const body: unknown = await context.req.json().catch(() => undefined)
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new WorkspaceError(
          GIT_ERROR_CODE.INVALID_REQUEST,
          'Git 操作参数无效。',
          400,
        )
      const record = body as Record<string, unknown>
      const action = record.action as GitAction
      const fields = writeActionFields.get(action)
      if (
        !fields ||
        typeof record.revision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.revision) ||
        Object.keys(record).some(
          (key) => !['action', 'revision', ...fields].includes(key),
        ) ||
        fields.some(
          (field) =>
            typeof record[field] !== 'string' ||
            !(record[field] as string).length ||
            (record[field] as string).length > 10_000 ||
            (record[field] as string).includes('\0'),
        )
      ) {
        throw new WorkspaceError(
          GIT_ERROR_CODE.INVALID_REQUEST,
          'Git 操作参数无效。',
          400,
        )
      }
      return git.act(id, {
        action,
        revision: record.revision,
        ...Object.fromEntries(fields.map((field) => [field, record[field]])),
      })
    }),
  }
}
