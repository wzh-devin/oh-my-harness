import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { createPreferencesController } from '../../controller/settings/preferences-controller.ts'
import type { PreferencesService } from '../../infrastructure/settings/preferences-service.ts'
import { settingsMutationGuard } from '../skills/import-guards.ts'

/** 应用偏好只接受本地可信来源的小型 JSON 请求。 */
export const createPreferencesRouter = (
  settings: PreferencesService,
  publicUrl: string,
) => {
  const router = new Hono()
  const controller = createPreferencesController(settings)
  router.use('*', settingsMutationGuard(publicUrl, 'PREFERENCES_FORBIDDEN'))
  router.use('*', bodyLimit({ maxSize: 16 * 1024 }))
  router.get('/', controller.get)
  router.put(
    '/',
    async (context, next) =>
      context.req.header('content-type')?.startsWith('application/json')
        ? next()
        : context.json(
            {
              code: 'INVALID_PREFERENCES_REQUEST',
              message: '偏好设置只接受 JSON。',
            },
            415,
          ),
    controller.update,
  )
  return router
}
