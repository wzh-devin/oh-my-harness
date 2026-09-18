import {
  McpError,
  parseMcpJson,
  type McpService,
} from '@oh-my-harness/agent-tools'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { McpListDto, McpPreviewDto } from '../../dto/mcp/mcp-dto.ts'

/** HTTP 只接收明确字段；业务配置校验由 MCP 能力统一执行。 */
const requestBody = async (c: Context, fields: readonly string[]) => {
  const body: unknown = await c.req.json().catch(() => undefined)
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !fields.includes(key))
  )
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '请求字段无效。')
  return body as Record<string, unknown>
}
const nameField = (value: unknown) => {
  if (typeof value !== 'string')
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '请填写服务名称。')
  return value
}
const configSource = (body: Record<string, unknown>) => {
  if (typeof body.source !== 'string')
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '请提交 JSON 配置文本。')
  return parseMcpJson(body.source)
}

/** 将 MCP 能力映射到安全 HTTP 响应，隐藏协议异常和敏感输入。 */
export const createMcpController = (mcp: McpService) => {
  const protect =
    (operation: (c: Context) => Promise<Response>) => async (c: Context) => {
      try {
        return await operation(c)
      } catch (error) {
        return c.json(
          error instanceof McpError
            ? { code: error.code, message: error.message }
            : {
                code: MCP_ERROR_CODE.UNAVAILABLE,
                message: 'MCP 操作失败，请重试；已保存配置不会被清空。',
              },
          (error instanceof McpError
            ? error.status
            : 500) as ContentfulStatusCode,
        )
      }
    }
  return {
    authMetadata: protect(async (c) => c.json(mcp.auth.clientMetadata())),
    authInfo: protect(async (c) =>
      c.json(mcp.auth.info(await mcp.authConfig(c.req.param('id')!))),
    ),
    authStart: protect(async (c) => {
      await requestBody(c, [])
      return c.json(
        await mcp.auth.start(
          await mcp.authConfig(c.req.param('id')!),
          c.req.raw.signal,
        ),
        201,
      )
    }),
    authSession: protect(async (c) =>
      c.json(
        await mcp.auth.session(
          await mcp.authConfig(c.req.param('id')!),
          c.req.param('sessionId')!,
        ),
      ),
    ),
    authCancel: protect(async (c) => {
      await mcp.auth.cancel(
        await mcp.authConfig(c.req.param('id')!),
        c.req.param('sessionId')!,
      )
      return c.json({ ok: true })
    }),
    authCredentials: protect(async (c) => {
      const body = await requestBody(c, ['token', 'headers', 'env'])
      await mcp.auth.credentials(await mcp.authConfig(c.req.param('id')!), body)
      return c.json({ ok: true })
    }),
    authDisconnect: protect(async (c) => {
      await mcp.auth.disconnect(await mcp.authConfig(c.req.param('id')!))
      return c.json({ ok: true })
    }),
    authCallback: async (c: Context) => {
      c.header('Referrer-Policy', 'no-referrer')
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      )
      let succeeded = false
      try {
        await mcp.auth.callback(new URL(c.req.url).searchParams)
        succeeded = true
      } catch {
        /* 不回显授权码及远端错误。 */
      }
      return c.html(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>连接服务</title><body style="font:18px system-ui;padding:48px"><h1>${succeeded ? '授权已完成' : '授权未完成'}</h1><p>${succeeded ? '请返回 oh-my-harness，连接状态会自动更新。' : '请返回 oh-my-harness，取消后重新连接。'}</p></body></html>`,
        succeeded ? 200 : 400,
      )
    },
    list: protect(async (c) => c.json((await mcp.list()) satisfies McpListDto)),
    config: protect(async (c) => c.json(await mcp.config())),
    secret: protect(async (c) => {
      const body = await requestBody(c, ['key', 'revision'])
      return c.json(
        await mcp.secret(c.req.param('id')!, body.key, body.revision as number),
      )
    }),
    preview: protect(async (c) => {
      const body = await requestBody(c, ['source', 'revision'])
      return c.json(
        (await mcp.preview(
          configSource(body),
          body.revision as number,
        )) satisfies McpPreviewDto,
      )
    }),
    replace: protect(async (c) => {
      const body = await requestBody(c, [
        'source',
        'revision',
        'confirmedDeletedIds',
      ])
      if (
        body.confirmedDeletedIds !== undefined &&
        (!Array.isArray(body.confirmedDeletedIds) ||
          body.confirmedDeletedIds.some((id) => typeof id !== 'string'))
      )
        throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '删除确认列表无效。')
      return c.json(
        (await mcp.replace(
          configSource(body),
          body.revision as number,
          body.confirmedDeletedIds as string[] | undefined,
        )) satisfies McpListDto,
      )
    }),
    save: protect(async (c) => {
      const body = await requestBody(c, ['name', 'config', 'revision'])
      return c.json(
        (await mcp.save(
          nameField(body.name),
          body.config,
          body.revision as number,
          c.req.param('id'),
        )) satisfies McpListDto,
      )
    }),
    remove: protect(async (c) => {
      const body = await requestBody(c, ['revision'])
      return c.json(
        (await mcp.remove(
          c.req.param('id')!,
          body.revision as number,
        )) satisfies McpListDto,
      )
    }),
    reconnect: protect(async (c) => {
      const body = await requestBody(c, ['revision'])
      return c.json(
        (await mcp.reconnect(
          c.req.param('id')!,
          body.revision as number,
        )) satisfies McpListDto,
      )
    }),
    test: protect(async (c) => {
      const body = await requestBody(c, ['name', 'config', 'id'])
      if (body.id !== undefined && typeof body.id !== 'string')
        throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '服务 ID 无效。')
      return c.json(
        await mcp.test(
          nameField(body.name),
          body.config,
          c.req.raw.signal,
          body.id as string | undefined,
        ),
      )
    }),
    tools: protect(async (c) => c.json(await mcp.tools(c.req.param('id')!))),
  }
}
