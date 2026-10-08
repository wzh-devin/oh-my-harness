import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { createRunSummaryController } from '../../controller/agent/run-summary-controller.ts'
import type { SandboxSettingsService } from '../../infrastructure/settings/sandbox-settings-service.ts'
import type { AgentRuntime } from '@oh-my-harness/agent-runtime'

/** 注册跨会话 Run 查询与恢复 API。 */
export function createRunSummaryRouter(
  runtime: AgentRuntime,
  sandboxSettings: SandboxSettingsService,
) {
  const router = new Hono()
  const controller = createRunSummaryController(runtime, sandboxSettings)
  router.get('/', controller.list)
  router.post(
    '/:runId/recover',
    bodyLimit({ maxSize: 4096 }),
    controller.recover,
  )
  return router
}
