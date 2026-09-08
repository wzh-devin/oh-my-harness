import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { PluginService } from '@oh-my-harness/agent-plugins'
import type { McpConnectionService } from '@oh-my-harness/agent-tools'
import { createPluginController } from '../../controller/plugins/plugin-controller.ts'
import { settingsMutationGuard } from './import-guards.ts'

export function createPluginRouter(
  plugins: PluginService,
  connections: McpConnectionService,
) {
  const router = new Hono()
  const controller = createPluginController(plugins, connections)
  router.use('/plugin-*', bodyLimit({ maxSize: 65 * 1024 * 1024 }))
  router.use('/plugin-*', async (c, next) => {
    if (c.req.header('content-type')?.includes('application/json'))
      return bodyLimit({ maxSize: 256 * 1024 })(c, next)
    await next()
  })
  router.use('/plugin-*', settingsMutationGuard(connections.redirectUrl))
  router.get('/plugin-imports/:id', controller.getImport)
  router.get('/plugin-imports/:id/preview', controller.previewImport)
  router.post('/plugin-imports', controller.createImport)
  router.delete('/plugin-imports/:id', controller.cancelImport)
  router.get('/plugin-marketplaces', controller.listMarketplaces)
  router.post('/plugin-marketplaces', controller.registerMarketplace)
  router.post('/plugin-marketplaces/:id/refresh', controller.refreshMarketplace)
  router.delete('/plugin-marketplaces/:id', controller.removeMarketplace)
  router.get('/plugin-installations', controller.listInstallations)
  router.post('/plugin-installations', controller.install)
  router.patch('/plugin-installations/:id', controller.setEnabled)
  router.post('/plugin-installations/:id/update', controller.update)
  router.post('/plugin-installations/:id/rollback', controller.rollback)
  router.delete('/plugin-installations/:id', controller.uninstall)
  router.get('/plugin-connections', controller.listConnections)
  router.post('/plugin-connections/:id/test', controller.testConnection)
  router.put('/plugin-connections/:id', controller.configureConnection)
  router.delete('/plugin-connections/:id', controller.disconnect)
  router.post('/plugin-oauth-sessions', controller.startOAuth)
  router.get('/plugin-oauth-sessions/callback', controller.callback)
  router.get('/plugin-oauth-sessions/complete', (c) => {
    c.header('Referrer-Policy', 'no-referrer')
    return c.html(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>插件认证</title><p>认证流程已返回。请回到应用查看连接状态，可以关闭此页。</p></html>',
    )
  })
  router.get('/plugin-oauth-sessions/:id', controller.getOAuth)
  router.delete('/plugin-oauth-sessions/:id', controller.cancelOAuth)
  return router
}
