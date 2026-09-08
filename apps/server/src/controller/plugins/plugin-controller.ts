import { TOOL_PERMISSION } from '@oh-my-harness/agent-policy/contracts'
import { join } from 'node:path'
import { ToolPolicy } from '@oh-my-harness/agent-policy'
import {
  PluginError,
  type PluginService,
  type PluginInstallation,
  type PluginMarketplace,
} from '@oh-my-harness/agent-plugins'
import {
  pluginConnectionTargets,
  createMcpTools,
  type McpConnectionService,
  type McpConnectionSettings,
} from '@oh-my-harness/agent-tools'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  PluginInstallationDto,
  PluginMarketplaceDto,
} from '../../dto/plugins/plugin-dto.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PluginError('PLUGIN_REQUEST_INVALID', '请求格式无效')
  return value as Record<string, unknown>
}
const text = (value: unknown, max = 1000) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    value.includes('\0')
  )
    throw new PluginError('PLUGIN_REQUEST_INVALID', '请求字段无效')
  return value
}
const optional = (value: unknown, max?: number) =>
  value === undefined ? undefined : text(value, max)

/** 只输出可公开的安装状态，隐藏资源路径与 MCP 凭据。 */
export const installationDto = (
  item: PluginInstallation,
): PluginInstallationDto => {
  const { descriptor, sourceSnapshot } = item.activeRevision
  return {
    id: item.id,
    name: descriptor.name,
    description: descriptor.description,
    version: descriptor.version,
    format: descriptor.format,
    enabled: item.enabled,
    blocked: descriptor.blocked,
    revision: item.activeRevision.id,
    canRollback: !!item.previousRevision,
    source:
      sourceSnapshot.source.type === 'git'
        ? sourceSnapshot.source.url
        : sourceSnapshot.source.name,
    compatibility: descriptor.compatibility,
    skills: descriptor.skills.length,
    commands: descriptor.commands.length,
  }
}
const marketplaceDto = (
  item: PluginMarketplace,
  installedIds: ReadonlyMap<string, string> = new Map(),
): PluginMarketplaceDto => ({
  id: item.id,
  name: item.descriptor.name,
  displayName: item.descriptor.displayName,
  format: item.descriptor.format,
  source:
    item.sourceSnapshot.source.type === 'git'
      ? item.sourceSnapshot.source.url
      : item.sourceSnapshot.source.name,
  entries: item.descriptor.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    available: !!entry.source,
    installationId: installedIds.get(`${item.id}:${entry.id}`),
    compatibility: entry.compatibility,
  })),
})

/** 转换插件 HTTP 输入与输出，领域操作交由能力包处理。 */
export function createPluginController(
  plugins: PluginService,
  connections: McpConnectionService,
) {
  const protect =
    (operation: (context: Context) => Promise<Response>) =>
    async (context: Context) => {
      try {
        return await operation(context)
      } catch (error) {
        return context.json(
          error instanceof PluginError
            ? { code: error.code, message: error.message }
            : {
                code: 'PLUGIN_OPERATION_FAILED',
                message:
                  '插件操作失败，请检查配置与连接状态；敏感错误详情未返回。',
              },
          (error instanceof PluginError
            ? error.status
            : 400) as ContentfulStatusCode,
        )
      }
    }
  const targets = async () =>
    pluginConnectionTargets(
      (await plugins.list()).installations.map((item) => ({
        ...item,
        rootDirectory: join(
          plugins.directory,
          'installations',
          item.id,
          item.activeRevision.id,
        ),
      })),
    )
  const target = async (id: string) => {
    const found = (await targets()).find((item) => item.id === id)
    if (!found)
      throw new PluginError('PLUGIN_CONNECTION_NOT_FOUND', '连接不存在', 404)
    return found
  }
  return {
    listInstallations: protect(async (c) =>
      c.json({
        installations: (await plugins.list()).installations.map(
          installationDto,
        ),
      }),
    ),
    listMarketplaces: protect(async (c) => {
      const registry = await plugins.list()
      const installedIds = new Map(
        registry.installations.flatMap((item) =>
          item.catalogEntryId ? [[item.catalogEntryId, item.id] as const] : [],
        ),
      )
      return c.json({
        marketplaces: registry.marketplaces.map((market) =>
          marketplaceDto(market, installedIds),
        ),
      })
    }),
    createImport: protect(async (c) => {
      if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
        const form = await c.req.formData()
        const file = form.get('file')
        if (
          !(file instanceof File) ||
          !file.name.toLowerCase().endsWith('.zip') ||
          file.size > 64 * 1024 * 1024
        )
          throw new PluginError(
            'PLUGIN_UPLOAD_INVALID',
            '请选择不超过 64 MiB 的 ZIP 文件',
          )
        return c.json(
          await plugins.createImport({
            zip: Buffer.from(await file.arrayBuffer()),
            name: file.name,
          }),
          202,
        )
      }
      const data = record(await c.req.json())
      return c.json(
        await plugins.createImport({
          url: text(data.url),
          ref: optional(data.ref, 200),
          path: optional(data.path, 500),
        }),
        202,
      )
    }),
    getImport: protect(async (c) =>
      c.json(plugins.getImport(c.req.param('id')!)),
    ),
    previewImport: protect(async (c) => {
      const result = await plugins.preview(
        c.req.param('id')!,
        text(c.req.query('candidate')),
      )
      // Never return raw MCP headers, env values or marketplace inline definitions.
      return c.json(
        'entries' in result
          ? {
              name: result.name,
              format: result.format,
              entries: result.entries.map((entry) => ({
                id: entry.id,
                name: entry.name,
                description: entry.description,
                available: !!entry.source,
                compatibility: entry.compatibility,
              })),
            }
          : {
              name: result.name,
              description: result.description,
              version: result.version,
              format: result.format,
              skills: result.skills.length,
              commands: result.commands.length,
              servers: result.servers.map((server) => ({
                name: server.name,
                transport: server.transport,
              })),
              compatibility: result.compatibility,
              blocked: result.blocked,
            },
      )
    }),
    cancelImport: protect(async (c) => {
      await plugins.cancelImport(c.req.param('id')!)
      return c.body(null, 204)
    }),
    registerMarketplace: protect(async (c) => {
      const data = record(await c.req.json())
      return c.json(
        marketplaceDto(
          await plugins.registerMarketplace(
            text(data.importId),
            text(data.candidate),
            optional(data.replaceId),
          ),
        ),
        201,
      )
    }),
    refreshMarketplace: protect(async (c) =>
      c.json(
        marketplaceDto(await plugins.refreshMarketplace(c.req.param('id')!)),
      ),
    ),
    removeMarketplace: protect(async (c) => {
      await plugins.remove(c.req.param('id')!, 'marketplace')
      return c.body(null, 204)
    }),
    install: protect(async (c) => {
      const data = record(await c.req.json())
      const result = data.marketplaceId
        ? await plugins.installCatalog(
            text(data.marketplaceId),
            text(data.entryId),
          )
        : await plugins.installImport(
            text(data.importId),
            text(data.candidate),
            optional(data.replaceId),
          )
      return c.json(installationDto(result), 201)
    }),
    setEnabled: protect(async (c) => {
      const data = record(await c.req.json())
      if (typeof data.enabled !== 'boolean')
        throw new PluginError('PLUGIN_REQUEST_INVALID', 'enabled 必须是布尔值')
      await plugins.setEnabled(c.req.param('id')!, data.enabled)
      return c.body(null, 204)
    }),
    update: protect(async (c) =>
      c.json(
        installationDto(await plugins.updateInstallation(c.req.param('id')!)),
      ),
    ),
    rollback: protect(async (c) => {
      await plugins.rollback(c.req.param('id')!)
      return c.body(null, 204)
    }),
    uninstall: protect(async (c) => {
      const id = c.req.param('id')!
      for (const item of await targets())
        if (item.installationId === id) await connections.disconnect(item.id)
      await plugins.remove(id, 'installation')
      return c.body(null, 204)
    }),
    listConnections: protect(async (c) =>
      c.json({
        connections: await Promise.all(
          (await targets()).map((item) => connections.status(item)),
        ),
      }),
    ),
    configureConnection: protect(async (c) => {
      const data = record(await c.req.json())
      if (typeof data.allowed !== 'boolean')
        throw new PluginError('PLUGIN_REQUEST_INVALID', '请显式确认连接权限')
      const environment =
        data.environment === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(record(data.environment)).map(([key, value]) => {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(key))
                  throw new PluginError(
                    'PLUGIN_REQUEST_INVALID',
                    '环境变量名无效',
                  )
                return [key, text(value, 8192)]
              }),
            )
      const settings: McpConnectionSettings = {
        allowed: data.allowed,
        environment,
        clientId: optional(data.clientId),
        clientSecret: optional(data.clientSecret, 8192),
        clientMetadataUrl: optional(data.clientMetadataUrl),
        scope: optional(data.scope),
      }
      if (
        settings.clientMetadataUrl &&
        new URL(settings.clientMetadataUrl).protocol !== 'https:'
      )
        throw new PluginError(
          'PLUGIN_REQUEST_INVALID',
          '客户端元数据地址必须为 HTTPS',
        )
      await connections.configure(await target(c.req.param('id')!), settings)
      return c.body(null, 204)
    }),
    disconnect: protect(async (c) =>
      c.json(
        await connections.disconnect((await target(c.req.param('id')!)).id),
      ),
    ),
    testConnection: protect(async (c) => {
      const item = await target(c.req.param('id')!)
      const toolset = await createMcpTools({
        connections,
        targets: [item],
        policy: new ToolPolicy(),
        permission: TOOL_PERMISSION.READ_ONLY,
        runId: 'connection-test',
        sessionId: 'connection-test',
        signal: AbortSignal.timeout(30_000),
        onApprovalRequested: async () => {
          throw new Error('检测不执行工具')
        },
        onApprovalResolved: async () => {},
      })
      try {
        if (toolset.diagnostics.length)
          throw new PluginError(
            'PLUGIN_CONNECTION_FAILED',
            '连接检测失败，请检查配置、运行依赖和认证',
          )
        return c.json({ toolCount: toolset.tools.length })
      } finally {
        await toolset.cleanup()
      }
    }),
    startOAuth: protect(async (c) =>
      c.json(
        await connections.startOAuth(
          await target(text(record(await c.req.json()).connectionId)),
        ),
        201,
      ),
    ),
    getOAuth: protect(async (c) =>
      c.json(connections.oauthStatus(c.req.param('id')!)),
    ),
    cancelOAuth: protect(async (c) => {
      connections.cancelOAuth(c.req.param('id')!)
      return c.body(null, 204)
    }),
    callback: async (c: Context) => {
      try {
        await connections.callback(
          text(c.req.query('state'), 200),
          optional(c.req.query('code'), 4096),
          !!c.req.query('error'),
        )
      } catch {
        /* Always scrub the callback query before presenting a result. */
      }
      c.header('Cache-Control', 'no-store')
      c.header('Referrer-Policy', 'no-referrer')
      return c.redirect('/api/plugin-oauth-sessions/complete', 303)
    },
  }
}
