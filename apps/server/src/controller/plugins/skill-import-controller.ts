import { PluginError } from '@oh-my-harness/agent-plugins'
import type {
  AgentRuntime,
  SkillImportService,
} from '@oh-my-harness/agent-runtime'
import { AgentRuntimeError } from '@oh-my-harness/agent-runtime'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  SkillImportDto,
  SkillDetailDto,
} from '../../dto/plugins/skill-import-dto.ts'

/** 在 HTTP 边界限制可用字段，不允许客户端决定安装路径。 */
const field = (data: unknown, key: string) => {
  const value =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)[key]
      : undefined
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1000 ||
    value.includes('\0')
  )
    throw new PluginError('SKILL_REQUEST_INVALID', '请求字段无效')
  return value.trim()
}

/** 转换独立技能导入请求，并在安装成功后失效运行时缓存。 */
export const createSkillImportController = (
  imports: SkillImportService,
  runtime: Pick<
    AgentRuntime,
    'refreshCapabilities' | 'getSkillDetail' | 'deleteSkill'
  >,
) => {
  const protect =
    (operation: (c: Context) => Promise<Response>) => async (c: Context) => {
      try {
        return await operation(c)
      } catch (error) {
        return c.json(
          error instanceof PluginError || error instanceof AgentRuntimeError
            ? { code: error.code, message: error.message }
            : {
                code: 'SKILL_IMPORT_FAILED',
                message: '技能导入失败，请重试；已有技能未被覆盖',
              },
          (error instanceof PluginError || error instanceof AgentRuntimeError
            ? error.status
            : 400) as ContentfulStatusCode,
        )
      }
    }
  return {
    create: protect(async (c) => {
      let result: SkillImportDto
      if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
        const file = (await c.req.formData()).get('file')
        if (
          !(file instanceof File) ||
          !file.name.toLowerCase().endsWith('.zip') ||
          file.size > 64 * 1024 * 1024
        )
          throw new PluginError(
            'SKILL_UPLOAD_INVALID',
            '请选择不超过 64 MiB 的 ZIP 文件',
          )
        result = await imports.create({
          zip: Buffer.from(await file.arrayBuffer()),
          name: file.name,
        })
      } else
        result = await imports.create({ url: field(await c.req.json(), 'url') })
      return c.json(result, 202)
    }),
    get: protect(async (c) => {
      const result: SkillImportDto = imports.get(c.req.param('id')!)
      return c.json(result)
    }),
    install: protect(async (c) => {
      const result = await imports.install(
        c.req.param('id')!,
        field(await c.req.json(), 'candidate'),
      )
      runtime.refreshCapabilities()
      return c.json(result)
    }),
    cancel: protect(async (c) => {
      await imports.cancel(c.req.param('id')!)
      return c.body(null, 204)
    }),
    detail: protect(async (c) =>
      c.json(
        (await runtime.getSkillDetail(
          c.req.param('id')!,
        )) satisfies SkillDetailDto,
      ),
    ),
    remove: protect(async (c) => {
      await runtime.deleteSkill(c.req.param('id')!)
      return c.json({ message: '技能已删除，副本保留在本地回收目录' })
    }),
  }
}
