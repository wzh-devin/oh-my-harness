import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AgentRuntime } from '@oh-my-harness/agent-runtime'

import { createWorkspaceController } from '../../controller/workspace/workspace-controller.ts'
import type { FileEditorService } from '../../infrastructure/workspace/file-editor-service.ts'
import type { WorkspaceStore } from '../../infrastructure/workspace/workspace-store.ts'

const workspaceBodyLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (context) =>
    context.json({ code: 'REQUEST_TOO_LARGE', message: '请求内容过大。' }, 413),
})

/** 注册本地工作区查询与创建路由。 */
export function createWorkspaceRouter(
  workspaces: WorkspaceStore,
  dataDirectory: string,
  runtime: AgentRuntime,
  fileEditors: FileEditorService,
) {
  const router = new Hono()
  const controller = createWorkspaceController(
    workspaces,
    dataDirectory,
    runtime,
    fileEditors,
  )
  router.get('/', controller.list)
  router.get('/file-editor', controller.getFileEditor)
  router.post('/file-editor/select', controller.selectFileEditor)
  router.put(
    '/file-editor/default',
    workspaceBodyLimit,
    controller.setDefaultFileEditor,
  )
  router.delete('/file-editor/default', controller.clearDefaultFileEditor)
  router.get('/:workspaceId/files/content', controller.readFile)
  router.get('/:workspaceId/files/image', controller.readImage)
  router.post(
    '/:workspaceId/files/open',
    workspaceBodyLimit,
    controller.openFile,
  )
  router.delete('/:workspaceId', controller.delete)
  router.post('/select', controller.select)
  router.post('/', workspaceBodyLimit, controller.create)
  return router
}
