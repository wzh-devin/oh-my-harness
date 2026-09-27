import { isSandboxMode } from '@oh-my-harness/shared'
import type { Context } from 'hono'

import {
  SandboxSettingsError,
  type SandboxSettingsService,
} from '../../infrastructure/settings/sandbox-settings-service.ts'

const errorResponse = (context: Context, error: unknown) =>
  error instanceof SandboxSettingsError
    ? context.json({ code: error.code, message: error.message }, error.status)
    : context.json(
        {
          code: 'SANDBOX_SETTINGS_FAILED',
          message: '沙箱设置请求处理失败。',
        },
        500,
      )

/** 读取和更新服务端沙箱设置。 */
export const createSandboxSettingsController = (
  settings: SandboxSettingsService,
) => ({
  get: async (context: Context) => {
    try {
      return context.json(await settings.get())
    } catch (error) {
      return errorResponse(context, error)
    }
  },
  update: async (context: Context) => {
    const input = await context.req.json<unknown>().catch(() => undefined)
    const mode =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as { mode?: unknown }).mode
        : undefined
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !isSandboxMode(mode)
    ) {
      return context.json(
        { code: 'INVALID_SANDBOX_MODE', message: '沙箱模式无效。' },
        400,
      )
    }
    try {
      return context.json(await settings.setMode(mode))
    } catch (error) {
      return errorResponse(context, error)
    }
  },
})
