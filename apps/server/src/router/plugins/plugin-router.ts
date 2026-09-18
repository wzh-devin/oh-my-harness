import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { PLUGIN_ERROR_CODE } from '@oh-my-harness/shared'
import type { PluginService } from '@oh-my-harness/agent-plugins'
import type { McpService } from '@oh-my-harness/agent-tools'
import type { AgentRuntime } from '@oh-my-harness/agent-runtime'
import { settingsMutationGuard } from '../skills/import-guards.ts'
import { createPluginController } from '../../controller/plugins/plugin-controller.ts'

/** 本地插件管理 API 的来源、Host、内容类型与大小边界。 */
export const createPluginRouter = (
  plugins: PluginService,
  mcp: McpService,
  runtime: AgentRuntime,
  publicUrl: string,
) => {
  const router = new Hono()
  const controller = createPluginController(plugins, mcp, runtime)
  router.use(
    '*',
    settingsMutationGuard(publicUrl, PLUGIN_ERROR_CODE.REQUEST_REJECTED),
  )
  router.use('*', bodyLimit({ maxSize: 256 * 1024 }))
  router.use('*', async (c, next) => {
    const hosts = [new URL(publicUrl).host, 'localhost:5173', '127.0.0.1:5173']
    if (process.env.OH_MY_HARNESS_WEB_ORIGIN)
      hosts.push(new URL(process.env.OH_MY_HARNESS_WEB_ORIGIN).host)
    if (!hosts.includes(c.req.header('host') ?? new URL(c.req.url).host))
      return c.json(
        {
          code: PLUGIN_ERROR_CODE.REQUEST_REJECTED,
          message: '请求 Host 不受信任。',
        },
        403,
      )
    if (
      !['GET', 'HEAD', 'DELETE'].includes(c.req.method) &&
      !c.req.header('content-type')?.startsWith('application/json')
    )
      return c.json(
        {
          code: PLUGIN_ERROR_CODE.REQUEST_REJECTED,
          message: '插件写操作只接受 JSON。',
        },
        415,
      )
    await next()
  })
  router.get('/markets', controller.markets)
  router.post('/markets', controller.addMarket)
  router.post('/markets/:id/refresh', controller.refreshMarket)
  router.delete('/markets/:id', controller.removeMarket)
  router.get('/catalog', controller.catalog)
  router.get('/icons/:id', controller.icon)
  router.post('/catalog/refresh', controller.refresh)
  router.get('/catalog/:id', controller.detail)
  router.get('/installations', controller.list)

  router.post('/operations', controller.prepare)
  router.get('/installations/:id/icon', controller.installationIcon)
  router.get('/mcp/:id/icon', controller.mcpIcon)
  router.post('/operations/direct', controller.prepareDirect)
  router.get('/operations/:id', controller.operation)
  router.delete('/operations/:id', controller.cancel)
  router.post('/operations/:id/commit', controller.commit)
  router.patch('/installations/:id', controller.update)
  router.post('/installations/:id/rollback', controller.rollback)
  router.post('/installations/:id/hooks/trust', controller.trustHooks)
  router.delete('/installations/:id', controller.remove)
  return router
}
