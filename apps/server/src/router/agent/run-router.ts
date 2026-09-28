import type { AgentRuntime } from '@oh-my-harness/agent-runtime'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { createAgentRunController } from '../../controller/agent/run-controller.ts'
import { createToolExecutionController } from '../../controller/agent/tool-execution-controller.ts'
import type { SandboxSettingsService } from '../../infrastructure/settings/sandbox-settings-service.ts'

/** 注册 Agent 的流式运行与显式终止路由。 */
export function createAgentRunRouter(
  runtime: AgentRuntime,
  sandboxSettings: SandboxSettingsService,
) {
  const router = new Hono()
  const controller = createAgentRunController(runtime, sandboxSettings)
  const executions = createToolExecutionController(runtime)
  router.post(
    '/:id/messages/stream',
    bodyLimit({
      maxSize: 22 * 1024 * 1024,
      onError: (context) =>
        context.json(
          { code: 'REQUEST_TOO_LARGE', message: '请求内容过大。' },
          413,
        ),
    }),
    controller.prompt,
  )
  router.get('/:id/events/stream', controller.reconnect)
  router.get('/:id/tool-executions', executions.list)
  router.get('/:id/tool-executions/stream', executions.stream)
  router.get('/:id/tool-executions/:executionId', executions.get)
  router.get('/:id/tool-executions/:executionId/output', executions.output)
  router.post('/:id/tool-executions/:executionId/stop', executions.stop)
  router.post('/:id/tool-executions/:executionId/restart', executions.restart)
  router.delete(
    '/:id/tool-executions/:executionId/service',
    executions.removeService,
  )
  router.post(
    '/:id/steer',
    bodyLimit({
      maxSize: 1024 * 1024 + 4096,
      onError: (context) =>
        context.json(
          { code: 'REQUEST_TOO_LARGE', message: '请求内容过大。' },
          413,
        ),
    }),
    controller.steer,
  )
  router.post(
    '/:id/continue/stream',
    bodyLimit({ maxSize: 4096 }),
    controller.continue,
  )
  router.post('/:id/abort', controller.abort)
  router.get('/:id/tool-approvals/pending', controller.pendingApproval)
  router.post(
    '/:id/tool-approvals/:approvalId',
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (context) =>
        context.json(
          { code: 'REQUEST_TOO_LARGE', message: '请求内容过大。' },
          413,
        ),
    }),
    controller.resolveApproval,
  )
  return router
}
