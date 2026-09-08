import type { MiddlewareHandler } from 'hono'

/** 限制设置写操作的浏览器来源；本地 CLI 无 Origin 的请求保持可用。 */
export const settingsMutationGuard =
  (publicUrl: string): MiddlewareHandler =>
  async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('origin')
      const allowed = [
        new URL(publicUrl).origin,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        ...(process.env.OH_MY_HARNESS_WEB_ORIGIN
          ? [process.env.OH_MY_HARNESS_WEB_ORIGIN]
          : []),
      ]
      if (
        c.req.header('sec-fetch-site') === 'cross-site' ||
        (origin && !allowed.includes(origin))
      )
        return c.json(
          { code: 'PLUGIN_ORIGIN_REJECTED', message: '不允许跨站修改设置' },
          403,
        )
    }
    await next()
  }
