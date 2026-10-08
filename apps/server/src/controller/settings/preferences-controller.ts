import type { Context } from 'hono'
import type { PreferencesSnapshotDto } from '../../dto/settings/preferences-dto.ts'

import {
  PreferencesError,
  type PreferencesService,
} from '../../infrastructure/settings/preferences-service.ts'

const errorResponse = (context: Context, error: unknown) =>
  error instanceof PreferencesError
    ? context.json({ code: error.code, message: error.message }, error.status)
    : context.json(
        {
          code: 'PREFERENCES_FAILED',
          message: '偏好设置请求处理失败。',
        },
        500,
      )

/** 读取和更新应用级偏好。 */
export const createPreferencesController = (settings: PreferencesService) => ({
  get: async (context: Context) => {
    try {
      return context.json(
        (await settings.get()) satisfies PreferencesSnapshotDto,
      )
    } catch (error) {
      return errorResponse(context, error)
    }
  },
  update: async (context: Context) => {
    const input = await context.req.json<unknown>().catch(() => undefined)
    try {
      return context.json(
        (await settings.replace(input)) satisfies PreferencesSnapshotDto,
      )
    } catch (error) {
      return errorResponse(context, error)
    }
  },
})
