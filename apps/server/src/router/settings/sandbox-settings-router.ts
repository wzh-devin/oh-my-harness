import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { createSandboxSettingsController } from '../../controller/settings/sandbox-settings-controller.ts'
import type { SandboxSettingsService } from '../../infrastructure/settings/sandbox-settings-service.ts'
import { settingsMutationGuard } from '../skills/import-guards.ts'

/** 沙箱设置只接受本地可信来源的小型 JSON 请求。 */
export const createSandboxSettingsRouter = (
  settings: SandboxSettingsService,
  publicUrl: string,
) => {
  const router = new Hono()
  const controller = createSandboxSettingsController(settings)
  router.use(
    '*',
    settingsMutationGuard(publicUrl, 'SANDBOX_SETTINGS_FORBIDDEN'),
  )
  router.use('*', bodyLimit({ maxSize: 4096 }))
  router.get('/', controller.get)
  router.put(
    '/',
    async (context, next) =>
      context.req.header('content-type')?.startsWith('application/json')
        ? next()
        : context.json(
            {
              code: 'INVALID_SANDBOX_SETTINGS_REQUEST',
              message: '沙箱设置只接受 JSON。',
            },
            415,
          ),
    controller.update,
  )
  return router
}
