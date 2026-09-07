import type { AgentRuntime } from '@oh-my-harness/agent-runtime'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { createAgentSessionController } from '../../controller/agent/session-controller.ts'
import type { WorkspaceStore } from '../../infrastructure/workspace/workspace-store.ts'

const sessionBodyLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (context) =>
    context.json({ code: 'REQUEST_TOO_LARGE', message: '请求内容过大。' }, 413),
})

/** 注册 Agent Session CRUD 与消息读取路由。 */
export function createAgentSessionRouter(
  runtime: AgentRuntime,
  workspaces: WorkspaceStore,
) {
  const router = new Hono()
  const controller = createAgentSessionController(runtime, workspaces)
  router.post('/', sessionBodyLimit, controller.create)
  router.get('/', controller.list)
  router.delete('/archived', controller.clearArchived)
  router.get('/:id/attachments/:entryId/:contentIndex', controller.attachment)
  router.get('/:id/messages', controller.messages)
  router.get('/:id/trajectory', controller.trajectory)
  router.get('/:id/trajectory/search', controller.trajectorySearch)
  router.get('/:id/trajectory/:recordId', controller.trajectoryRecord)
  router.get('/:id', controller.get)
  router.patch('/:id', sessionBodyLimit, controller.update)
  router.delete('/:id', controller.delete)
  return router
}
