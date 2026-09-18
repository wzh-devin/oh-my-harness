import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { McpService } from '@oh-my-harness/agent-tools'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'
import { createMcpController } from '../../controller/mcp/mcp-controller.ts'
import { settingsMutationGuard } from '../skills/import-guards.ts'

/** MCP 配置和进程启动仅接受本地可信来源的受限 JSON 请求。 */
export const createMcpRouter = (mcp: McpService, publicUrl: string) => {
  const router = new Hono()
  const controller = createMcpController(mcp)
  router.use(
    '*',
    settingsMutationGuard(publicUrl, MCP_ERROR_CODE.REQUEST_REJECTED),
  )
  router.use('*', bodyLimit({ maxSize: 512 * 1024 }))
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const hosts = [new URL(publicUrl).host, 'localhost:5173', '127.0.0.1:5173']
    if (process.env.OH_MY_HARNESS_WEB_ORIGIN)
      hosts.push(new URL(process.env.OH_MY_HARNESS_WEB_ORIGIN).host)
    if (!hosts.includes(c.req.header('host') ?? new URL(c.req.url).host))
      return c.json(
        {
          code: MCP_ERROR_CODE.REQUEST_REJECTED,
          message: 'MCP 请求 Host 不受信任。',
        },
        403,
      )
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      !c.req.header('content-type')?.startsWith('application/json')
    )
      return c.json(
        {
          code: MCP_ERROR_CODE.REQUEST_REJECTED,
          message: 'MCP 写操作只接受 JSON。',
        },
        415,
      )
    await next()
  })
  router.get('/oauth/client-metadata', controller.authMetadata)
  router.get('/oauth/callback', controller.authCallback)
  router.get('/servers/:id/auth', controller.authInfo)
  router.post('/servers/:id/auth/sessions', controller.authStart)
  router.get('/servers/:id/auth/sessions/:sessionId', controller.authSession)
  router.delete('/servers/:id/auth/sessions/:sessionId', controller.authCancel)
  router.put('/servers/:id/auth/credentials', controller.authCredentials)
  router.delete('/servers/:id/auth', controller.authDisconnect)
  router.get('/servers', controller.list)
  router.post('/servers', controller.save)
  router.patch('/servers/:id', controller.save)
  router.delete('/servers/:id', controller.remove)
  router.post('/servers/:id/reconnect', controller.reconnect)
  router.get('/servers/:id/tools', controller.tools)
  router.post('/servers/:id/secret', controller.secret)
  router.post('/test', controller.test)
  router.get('/config', controller.config)
  router.post('/config/preview', controller.preview)
  router.put('/config', controller.replace)
  return router
}
