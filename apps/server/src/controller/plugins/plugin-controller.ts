import {
  PluginError,
  SourceError,
  type PluginService,
} from '@oh-my-harness/agent-plugins'
import { McpError, type McpService } from '@oh-my-harness/agent-tools'
import {
  AgentRuntimeError,
  type AgentRuntime,
} from '@oh-my-harness/agent-runtime'
import {
  PLUGIN_ERROR_CODE,
  PLUGIN_INSTALLATION_SOURCE_KIND,
} from '@oh-my-harness/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  PluginListDto,
  PluginCatalogDto,
  PluginOperationDto,
} from '../../dto/plugins/plugin-dto.ts'

/** 限制 HTTP 写入字段，来源由能力包校验且不得指定本地安装路径。 */
const bodyFields = async (c: Context, fields: readonly string[]) => {
  const value: unknown = await c.req.json().catch(() => undefined)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '请求字段无效。')
  return value as Record<string, unknown>
}

/** 装配插件状态与运行注册，任何变更均处于 Runtime 的同步保护中。 */
export const createPluginController = (
  plugins: PluginService,
  mcp: McpService,
  runtime: AgentRuntime,
) => {
  const list = async (): Promise<PluginListDto> => {
    const [installed, connected] = await Promise.all([
      plugins.list(),
      mcp.list(),
    ])
    return {
      revision: installed.revision,
      installations: await Promise.all(
        installed.installations.map(async (item) => {
          const entry =
            item.source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.MARKET
              ? await plugins.catalog.get(item.entryId).catch(() => undefined)
              : undefined
          return {
            ...item,
            latestVersion: entry?.version,
            servers: connected.servers
              .filter((server) => server.owner?.id === item.id)
              .map(({ id, name, status, error, toolCount, auth }) => ({
                auth,
                id,
                name,
                status,
                error,
                toolCount,
              })),
          }
        }),
      ),
    }
  }
  /** 图片响应只暴露校验后的包内资源；内容变更时浏览器重新验证缓存。 */
  const installationIcon = async (c: Context, id: string) => {
    const { bytes, mime, etag } = await plugins.icon(
      id,
      c.req.query('theme') === 'dark',
      c.req.query('variant') === 'composer',
    )
    c.header('Cache-Control', 'private, no-cache')
    c.header('ETag', etag)
    c.header('X-Content-Type-Options', 'nosniff')
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(new Uint8Array(bytes), 200, { 'Content-Type': mime })
  }
  const mutate = async (operation: () => Promise<unknown>) => {
    await runtime.withCapabilityMutation(async () => {
      let operationError: unknown
      try {
        await operation()
      } catch (error) {
        operationError = error
      }
      try {
        await mcp.setManagedServers((await plugins.capabilities()).servers)
      } catch {
        await mcp.setManagedServers([], true)
        throw new PluginError(
          PLUGIN_ERROR_CODE.UNAVAILABLE,
          '插件运行注册失败，已停止插件工具；请刷新后重试或重启服务。',
          503,
        )
      }
      if (operationError) throw operationError
    })
    return list()
  }
  const protect =
    (operation: (c: Context) => Promise<Response>) => async (c: Context) => {
      try {
        return await operation(c)
      } catch (error) {
        const known =
          error instanceof SourceError ||
          error instanceof McpError ||
          error instanceof AgentRuntimeError
        return c.json(
          {
            code: known ? error.code : PLUGIN_ERROR_CODE.UNAVAILABLE,
            message: known
              ? error.message
              : '插件操作失败，请重试；已保存的数据不会被清空。',
          },
          (known ? error.status : 500) as ContentfulStatusCode,
        )
      }
    }
  return {
    installationIcon: protect((c) => installationIcon(c, c.req.param('id')!)),
    mcpIcon: protect(async (c) => {
      const server = (await mcp.list()).servers.find(
        (item) => item.id === c.req.param('id'),
      )
      if (!server?.owner)
        throw new PluginError(
          PLUGIN_ERROR_CODE.NOT_FOUND,
          '服务未提供插件图标。',
          404,
        )
      return installationIcon(c, server.owner.id)
    }),
    icon: protect(async (c) => {
      const { bytes, mime } = await plugins.catalog.icon(c.req.param('id')!)
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      })
    }),
    catalog: protect(async (c) =>
      c.json(
        (await plugins.catalog.list(
          c.req.query('q'),
          c.req.query('category'),
          Number(c.req.query('offset') ?? 0),
          Number(c.req.query('limit') ?? 50),
          c.req.query('market'),
        )) satisfies PluginCatalogDto,
      ),
    ),
    refresh: protect(async (c) => {
      await plugins.catalog.refresh()
      return c.json(await plugins.catalog.list())
    }),
    markets: protect(async (c) => c.json(await plugins.catalog.markets())),
    addMarket: protect(async (c) => {
      const body = await bodyFields(c, ['url', 'ref', 'path'])
      await plugins.catalog.add(body, c.req.raw.signal)
      return c.json(await plugins.catalog.list(), 201)
    }),
    refreshMarket: protect(async (c) => {
      await bodyFields(c, [])
      await plugins.catalog.refreshMarket(c.req.param('id')!, c.req.raw.signal)
      return c.json(await plugins.catalog.list())
    }),
    removeMarket: protect(async (c) => {
      await plugins.catalog.removeMarket(c.req.param('id')!)
      return c.json(await plugins.catalog.list())
    }),
    detail: protect(async (c) =>
      c.json(await plugins.catalog.get(c.req.param('id')!)),
    ),
    list: protect(async (c) => c.json(await list())),
    prepare: protect(async (c) => {
      const body = await bodyFields(c, ['entryId'])
      if (
        typeof body.entryId !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(body.entryId)
      )
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '市场条目无效。')
      return c.json(
        (await plugins.prepare(body.entryId)) satisfies PluginOperationDto,
        202,
      )
    }),
    prepareDirect: protect(async (c) => {
      const body = await bodyFields(c, ['url', 'ref', 'path'])
      return c.json(
        (await plugins.prepareDirect(body)) satisfies PluginOperationDto,
        202,
      )
    }),
    operation: protect(async (c) =>
      c.json(plugins.operation(c.req.param('id')!)),
    ),
    cancel: protect(async (c) => {
      await plugins.cancel(c.req.param('id')!)
      return c.body(null, 204)
    }),
    commit: protect(async (c) => {
      await bodyFields(c, [])
      return c.json(await mutate(() => plugins.commit(c.req.param('id')!)))
    }),
    update: protect(async (c) => {
      const body = await bodyFields(c, ['revision', 'enabled', 'values'])
      return c.json(
        await mutate(() =>
          plugins.update(c.req.param('id')!, body.revision as number, {
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(body.values === undefined ? {} : { values: body.values }),
          }),
        ),
      )
    }),
    rollback: protect(async (c) => {
      const body = await bodyFields(c, ['revision'])
      return c.json(
        await mutate(() =>
          plugins.rollback(c.req.param('id')!, body.revision as number),
        ),
      )
    }),
    trustHooks: protect(async (c) => {
      const body = await bodyFields(c, ['revision', 'trusted'])
      return c.json(
        await mutate(() =>
          plugins.trustHooks(
            c.req.param('id')!,
            body.revision as number,
            body.trusted as boolean,
          ),
        ),
      )
    }),
    remove: protect(async (c) => {
      const body = await bodyFields(c, ['revision'])
      return c.json(
        await mutate(async () => {
          const id = c.req.param('id')!
          await mcp.setManagedServers(
            (await plugins.capabilities()).servers.filter(
              (server) => server.owner.id !== id,
            ),
          )
          await plugins.remove(id, body.revision as number)
        }),
      )
    }),
  }
}
