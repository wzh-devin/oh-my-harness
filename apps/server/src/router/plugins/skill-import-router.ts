import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type {
  AgentRuntime,
  SkillImportService,
} from '@oh-my-harness/agent-runtime'
import { createSkillImportController } from '../../controller/plugins/skill-import-controller.ts'
import { settingsMutationGuard } from './import-guards.ts'

/** 注册技能导入，不与市场或插件安装记录混用。 */
export const createSkillImportRouter = (
  imports: SkillImportService,
  runtime: Pick<
    AgentRuntime,
    'refreshCapabilities' | 'getSkillDetail' | 'deleteSkill'
  >,
  publicUrl: string,
) => {
  const router = new Hono()
  const controller = createSkillImportController(imports, runtime)
  router.use('/skills/*', settingsMutationGuard(publicUrl))
  router.use('/skill-imports/*', settingsMutationGuard(publicUrl))
  router.use('/skill-imports/*', bodyLimit({ maxSize: 65 * 1024 * 1024 }))
  router.use('/skill-imports/*', async (c, next) => {
    if (c.req.header('content-type')?.includes('application/json'))
      return bodyLimit({ maxSize: 16 * 1024 })(c, next)
    await next()
  })
  router.post('/skill-imports', controller.create)
  router.get('/skill-imports/:id', controller.get)
  router.post('/skill-imports/:id/install', controller.install)
  router.delete('/skill-imports/:id', controller.cancel)
  router.get('/skills/:id', controller.detail)
  router.delete('/skills/:id', controller.remove)
  return router
}
