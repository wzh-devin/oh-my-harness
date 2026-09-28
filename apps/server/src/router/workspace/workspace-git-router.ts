import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { GIT_ERROR_CODE } from '@oh-my-harness/shared'
import { createWorkspaceGitController } from '../../controller/workspace/workspace-git-controller.ts'
import { WorkspaceGitService } from '../../infrastructure/workspace/workspace-git-service.ts'
import type { WorkspaceStore } from '../../infrastructure/workspace/workspace-store.ts'
import { settingsMutationGuard } from '../skills/import-guards.ts'

/** Git 数据及写操作只接受可信本地页面和注册工作区 ID。 */
export const createWorkspaceGitRouter = (
  workspaces: WorkspaceStore,
  publicUrl: string,
) => {
  const router = new Hono()
  const controller = createWorkspaceGitController(
    new WorkspaceGitService(workspaces),
  )
  const trustedHostSet = new Set([
    new URL(publicUrl).host,
    'localhost:5173',
    '127.0.0.1:5173',
  ])
  if (process.env.OH_MY_HARNESS_WEB_ORIGIN)
    trustedHostSet.add(new URL(process.env.OH_MY_HARNESS_WEB_ORIGIN).host)
  router.use(
    '*',
    settingsMutationGuard(publicUrl, GIT_ERROR_CODE.REQUEST_REJECTED),
  )
  router.use('*', bodyLimit({ maxSize: 16 * 1024 }))
  router.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    if (
      !trustedHostSet.has(
        context.req.header('host') ?? new URL(context.req.url).host,
      ) ||
      context.req.header('x-oh-my-harness-request') !== 'workspace-git'
    ) {
      return context.json(
        {
          code: GIT_ERROR_CODE.REQUEST_REJECTED,
          message: 'Git 请求来源无效。',
        },
        403,
      )
    }
    if (
      context.req.method === 'POST' &&
      !context.req.header('content-type')?.startsWith('application/json')
    ) {
      return context.json(
        {
          code: GIT_ERROR_CODE.INVALID_REQUEST,
          message: 'Git 写操作只接受 JSON。',
        },
        415,
      )
    }
    await next()
  })
  router.get('/:workspaceId/git', controller.snapshot)
  router.get('/:workspaceId/git/diff', controller.diff)
  router.post('/:workspaceId/git/actions', controller.act)
  return router
}
