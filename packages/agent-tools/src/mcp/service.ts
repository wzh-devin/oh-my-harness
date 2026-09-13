import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  ToolListChangedNotificationSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  MCP_CHANGE_KIND,
  MCP_CONNECTION_STATUS,
  MCP_ERROR_CODE,
  MCP_TRANSPORT,
  type McpConnectionStatus,
} from '@oh-my-harness/shared'
import { McpConfigStore } from './config-store.ts'
import {
  McpError,
  knownSecrets,
  parseMcpServer,
  planMcpConfig,
  publicMcpConfig,
  redactMcpValue,
  type McpServerConfig,
} from './config.ts'

interface ActiveCall {
  controller: AbortController
  sessionId: string
  executing: boolean
}
interface Connection {
  config: McpServerConfig
  client: Client
  controller: AbortController
  status: McpConnectionStatus
  error?: string
  checkedAt?: string
  tools: Tool[]
  active: Set<ActiveCall>
  settled?: Promise<void>
  discovering?: Promise<void>
}
export interface McpServerInfo {
  id: string
  name: string
  transport: McpServerConfig['transport']
  enabled: boolean
  revision: number
  config: ReturnType<typeof publicMcpConfig>
  secretKeys: { env: string[]; headers: string[] }
  status: McpConnectionStatus
  error?: string
  checkedAt?: string
  toolCount: number
  activeSessionIds: string[]
}
export interface McpToolBinding {
  name: string
  serverId: string
  serverName: string
  revision: number
  toolVersion: string
  tool: Tool
  connection: Connection
}

/** 只转换可识别的错误代码，不把远端响应正文、命令参数或凭据作为错误回显。 */
const connectionErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof McpError) return error.message
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401)
      return '认证失败（HTTP 401）：请填写有效的访问令牌或 Authorization 请求头。本应用暂不支持 OAuth 登录。'
    if (error.code === 403)
      return '访问被拒绝（HTTP 403）：请检查令牌权限和服务访问策略。'
    if (error.code === 404)
      return '服务地址不存在（HTTP 404）：请填写 MCP 接口地址。'
    if (error.code === 429) return '服务请求过于频繁（HTTP 429），请稍后重试。'
    if (error.code && error.code >= 400)
      return `服务返回 HTTP ${error.code}，请检查服务状态后重试。`
  }
  const code =
    (error as NodeJS.ErrnoException | undefined)?.code ??
    ((error as Error | undefined)?.cause as NodeJS.ErrnoException | undefined)
      ?.code
  if (code === 'ENOENT')
    return '找不到启动程序，请检查可执行程序路径和安装情况。'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return '无法解析服务域名，请检查地址和网络。'
  if (code === 'ECONNREFUSED')
    return '连接被拒绝，请检查服务是否已启动以及端口是否正确。'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return '连接超时，请检查网络、代理和服务状态。'
  return undefined
}

const versionOf = (tool: Tool) =>
  createHash('sha256').update(JSON.stringify(tool)).digest('hex')

/** 管理应用级 MCP 配置和连接；Run 只使用确定快照，停用立即撤销连接生命周期。 */
export class McpService {
  private readonly store: McpConfigStore
  private readonly connections = new Map<string, Connection>()
  private readonly changing = new Set<string>()
  private closed = false
  private readonly tests = new Set<Connection>()
  constructor(dataDirectory: string) {
    this.store = new McpConfigStore(dataDirectory)
  }

  /** 启动已明确启用的服务；单个失败不影响宿主启动。 */
  async start() {
    const document = await this.store.read()
    const enabled = document.servers.filter((server) => server.enabled)
    // ponytail: 每批最多四个启动，避免同时拉起全部本地进程；实测有等待瓶颈再改队列。
    for (let index = 0; index < enabled.length && !this.closed; index += 4)
      await Promise.allSettled(
        enabled.slice(index, index + 4).map((server) => this.connect(server)),
      )
  }

  async list() {
    const document = await this.store.read()
    return {
      revision: document.revision,
      servers: document.servers.map((server) => this.info(server)),
    }
  }

  async config() {
    const document = await this.store.read()
    return {
      revision: document.revision,
      mcpServers: Object.fromEntries(
        document.servers.map((server) => [
          server.name,
          publicMcpConfig(server),
        ]),
      ),
      secretKeys: Object.fromEntries(
        document.servers.map((server) => [
          server.name,
          {
            env: Object.keys(server.env),
            headers: Object.keys(server.headers),
          },
        ]),
      ),
    }
  }

  async preview(value: unknown, revision: number) {
    const document = await this.store.read()
    this.checkRevision(document.revision, revision)
    return { revision, changes: planMcpConfig(document, value).changes }
  }

  /** 仅供用户显式查看单项凭据；普通配置投影始终不返回值。 */
  async secret(id: string, key: unknown, revision: number) {
    if (typeof key !== 'string' || !key || key.length > 256)
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '凭据键无效。')
    const document = await this.store.read()
    this.checkRevision(document.revision, revision)
    const server = document.servers.find((item) => item.id === id)
    if (!server)
      throw new McpError(MCP_ERROR_CODE.NOT_FOUND, '服务不存在。', 404)
    const values =
      server.transport === MCP_TRANSPORT.HTTP ? server.headers : server.env
    if (!Object.hasOwn(values, key))
      throw new McpError(
        MCP_ERROR_CODE.NOT_FOUND,
        '凭据不存在，请重新打开配置。',
        404,
      )
    return { value: values[key]! }
  }

  /** 批量写入先检查全部版本、删除确认与占用；连接失败不撤销持久化成功。 */
  async replace(
    value: unknown,
    revision: number,
    confirmedDeletedIds: readonly string[] = [],
  ) {
    return this.store.serialize(async () => {
      const document = await this.store.read()
      this.checkRevision(document.revision, revision)
      const plan = planMcpConfig(document, value)
      const deletions = plan.changes.filter(
        (change) => change.kind === MCP_CHANGE_KIND.DELETE,
      )
      if (deletions.some((change) => !confirmedDeletedIds.includes(change.id)))
        throw new McpError(
          MCP_ERROR_CODE.DELETE_CONFIRMATION,
          '请确认删除预览中列出的服务。',
          409,
        )
      const affected = plan.changes.map((change) => change.id)
      for (const id of affected) {
        const next = plan.servers.find((server) => server.id === id)
        const previous = document.servers.find((server) => server.id === id)
        const disabling =
          previous?.enabled &&
          next &&
          !next.enabled &&
          JSON.stringify({
            ...next,
            enabled: true,
            revision: previous.revision,
          }) === JSON.stringify(previous)
        if (!disabling) this.assertIdle(id)
      }
      if (!affected.length) return this.list()
      affected.forEach((id) => this.changing.add(id))
      try {
        await this.store.write({
          version: 1,
          revision: document.revision + 1,
          servers: plan.servers,
        })
        await Promise.all(affected.map((id) => this.disconnect(id)))
      } finally {
        affected.forEach((id) => this.changing.delete(id))
      }
      const enabled = plan.servers.filter(
        (server) => affected.includes(server.id) && server.enabled,
      )
      void this.connectBatch(enabled)
      return this.list()
    })
  }

  /** 单服务编辑复用完整配置计划；保留其他服务及所有省略的凭据。 */
  async save(name: string, config: unknown, revision: number, id?: string) {
    const document = await this.store.read()
    this.checkRevision(document.revision, revision)
    const previous = id
      ? document.servers.find((server) => server.id === id)
      : undefined
    if (id && !previous)
      throw new McpError(MCP_ERROR_CODE.NOT_FOUND, 'MCP 服务不存在。', 404)
    if (
      document.servers.some(
        (server) => server.name === name && server.id !== id,
      )
    )
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '服务名称已存在。')
    // 表单改名使用原 ID；JSON 键改名仍按明确的删除、新增处理。
    if (previous && previous.name !== name) {
      return this.store.serialize(async () => {
        const current = await this.store.read()
        this.checkRevision(current.revision, revision)
        this.assertIdle(id!)
        const next = parseMcpServer(name, config, previous)
        next.revision += 1
        this.changing.add(id!)
        try {
          await this.store.write({
            ...current,
            revision: revision + 1,
            servers: current.servers.map((server) =>
              server.id === id ? next : server,
            ),
          })
          await this.disconnect(id!)
        } finally {
          this.changing.delete(id!)
        }
        if (next.enabled) void this.connect(next).catch(() => undefined)
        return this.list()
      })
    }
    const records = Object.fromEntries(
      document.servers.map((server) => [server.name, publicMcpConfig(server)]),
    )
    return this.replace(
      { mcpServers: { ...records, [name]: config } },
      revision,
    )
  }

  async remove(id: string, revision: number) {
    const document = await this.store.read()
    if (!document.servers.some((server) => server.id === id))
      throw new McpError(MCP_ERROR_CODE.NOT_FOUND, 'MCP 服务不存在。', 404)
    return this.replace(
      {
        mcpServers: Object.fromEntries(
          document.servers
            .filter((server) => server.id !== id)
            .map((server) => [server.name, publicMcpConfig(server)]),
        ),
      },
      revision,
      [id],
    )
  }

  async reconnect(id: string, revision: number) {
    return this.store.serialize(async () => {
      const document = await this.store.read()
      this.checkRevision(document.revision, revision)
      const server = document.servers.find((server) => server.id === id)
      if (!server)
        throw new McpError(MCP_ERROR_CODE.NOT_FOUND, 'MCP 服务不存在。', 404)
      if (!server.enabled)
        throw new McpError(MCP_ERROR_CODE.UNAVAILABLE, '请先启用服务。', 409)
      this.assertIdle(id)
      this.changing.add(id)
      try {
        await this.disconnect(id)
      } finally {
        this.changing.delete(id)
      }
      void this.connect(server).catch(() => undefined)
      return this.list()
    })
  }

  /** 测试草稿不写配置，取消和失败均释放临时客户端与进程。 */
  async test(name: string, value: unknown, signal?: AbortSignal, id?: string) {
    const document = await this.store.read()
    const previous = id
      ? document.servers.find((server) => server.id === id)
      : undefined
    if (id && !previous)
      throw new McpError(MCP_ERROR_CODE.NOT_FOUND, 'MCP 服务不存在。', 404)
    const config = parseMcpServer(name, value, previous)
    if (this.closed || this.tests.size >= 4)
      throw new McpError(
        MCP_ERROR_CODE.SERVER_BUSY,
        '连接测试繁忙，请稍后重试。',
        409,
      )
    const connection = this.makeConnection(config)
    this.tests.add(connection)
    const onAbort = () => {
      connection.controller.abort()
      void connection.client.close().catch(() => undefined)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      signal?.throwIfAborted()
      await this.initialize(connection)
      if (connection.status !== MCP_CONNECTION_STATUS.CONNECTED)
        throw new McpError(
          MCP_ERROR_CODE.UNAVAILABLE,
          connection.error ?? '连接失败。',
          502,
        )
      return {
        toolCount: connection.tools.length,
        checkedAt: connection.checkedAt,
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      onAbort()
      await connection.client.close().catch(() => undefined)
      this.tests.delete(connection)
    }
  }

  async tools(id: string) {
    const document = await this.store.read()
    if (!document.servers.some((server) => server.id === id))
      throw new McpError(MCP_ERROR_CODE.NOT_FOUND, 'MCP 服务不存在。', 404)
    return this.connections.get(id)?.tools ?? []
  }

  /** 固定本轮工具目录；未就绪服务生成明确说明，不阻塞其他工具。 */
  async snapshot() {
    const document = await this.store.read()
    const bindings: McpToolBinding[] = [],
      unavailable: string[] = []
    for (const config of document.servers.filter((server) => server.enabled)) {
      const connection = this.connections.get(config.id)
      if (
        !connection ||
        connection.status !== MCP_CONNECTION_STATUS.CONNECTED ||
        this.changing.has(config.id)
      ) {
        unavailable.push(config.name)
        continue
      }
      for (const tool of connection.tools)
        bindings.push({
          name: `mcp_${config.id.replaceAll('-', '')}_${createHash('sha256').update(tool.name).digest('hex').slice(0, 20)}`,
          serverId: config.id,
          serverName: config.name,
          revision: config.revision,
          toolVersion: versionOf(tool),
          tool: structuredClone(tool),
          connection,
        })
    }
    return { bindings, unavailable }
  }

  /** 执行和审批共享租约；停用会通过生命周期信号取消尚未执行的授权。 */
  lease(binding: McpToolBinding, sessionId: string, runSignal?: AbortSignal) {
    this.checkBinding(binding)
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      binding.connection.controller.signal,
      ...(runSignal ? [runSignal] : []),
    ])
    const active: ActiveCall = { controller, sessionId, executing: false }
    binding.connection.active.add(active)
    return {
      signal,
      execute: async (args: Record<string, unknown>) => {
        signal.throwIfAborted()
        this.checkBinding(binding)
        active.executing = true
        try {
          const result = CallToolResultSchema.parse(
            await binding.connection.client.callTool(
              { name: binding.tool.name, arguments: args },
              undefined,
              { signal, timeout: 60_000 },
            ),
          )
          if (JSON.stringify(result).length > 4 * 1024 * 1024)
            throw new McpError(
              MCP_ERROR_CODE.CALL_FAILED,
              'MCP 工具结果超过 4 MiB 限制。',
            )
          return redactMcpValue(result, knownSecrets(binding.connection.config))
        } catch {
          throw new McpError(
            MCP_ERROR_CODE.CALL_FAILED,
            signal.aborted
              ? 'MCP 调用已取消；外部操作可能已经发生。'
              : 'MCP 调用失败或超时，未自动重试。',
            502,
          )
        } finally {
          active.executing = false
        }
      },
      release: () => {
        controller.abort()
        binding.connection.active.delete(active)
      },
    }
  }

  async close() {
    this.closed = true
    await Promise.all(
      [...this.tests].map(async (connection) => {
        connection.controller.abort()
        await connection.client.close().catch(() => undefined)
      }),
    )
    await Promise.all(
      [...this.connections.keys()].map((id) => this.disconnect(id)),
    )
  }

  private async connectBatch(servers: McpServerConfig[]) {
    for (let index = 0; index < servers.length && !this.closed; index += 4)
      await Promise.allSettled(
        servers.slice(index, index + 4).map((server) => this.connect(server)),
      )
  }

  private checkRevision(actual: number, expected: number) {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new McpError(
        MCP_ERROR_CODE.CONFIG_CONFLICT,
        '配置已被修改，请刷新后重新编辑。',
        409,
      )
    if (this.closed)
      throw new McpError(MCP_ERROR_CODE.UNAVAILABLE, 'MCP 管理器已关闭。', 503)
  }
  private assertIdle(id: string) {
    const active = [...(this.connections.get(id)?.active ?? [])].filter(
      (call) => call.executing,
    )
    if (active.length)
      throw new McpError(
        MCP_ERROR_CODE.SERVER_BUSY,
        `服务正在被会话 ${[...new Set(active.map((call) => call.sessionId))].join('、')} 调用，请停止任务后重试。`,
        409,
      )
  }
  private checkBinding(binding: McpToolBinding) {
    const connection = this.connections.get(binding.serverId)
    if (
      this.closed ||
      this.changing.has(binding.serverId) ||
      connection !== binding.connection ||
      connection.status !== MCP_CONNECTION_STATUS.CONNECTED ||
      connection.controller.signal.aborted ||
      connection.config.revision !== binding.revision ||
      !connection.tools.some(
        (tool) =>
          tool.name === binding.tool.name &&
          versionOf(tool) === binding.toolVersion,
      )
    )
      throw new McpError(
        MCP_ERROR_CODE.UNAVAILABLE,
        'MCP 服务已停用、断开或工具定义已变化，请在下一轮重新尝试。',
        409,
      )
  }
  private info(server: McpServerConfig): McpServerInfo {
    const connection = this.connections.get(server.id)
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      enabled: server.enabled,
      revision: server.revision,
      config: publicMcpConfig(server),
      secretKeys: {
        env: Object.keys(server.env),
        headers: Object.keys(server.headers),
      },
      status: !server.enabled
        ? MCP_CONNECTION_STATUS.DISABLED
        : (connection?.status ?? MCP_CONNECTION_STATUS.DISCONNECTED),
      error: connection?.error,
      checkedAt: connection?.checkedAt,
      toolCount: connection?.tools.length ?? 0,
      activeSessionIds: [
        ...new Set(
          [...(connection?.active ?? [])]
            .filter((call) => call.executing)
            .map((call) => call.sessionId),
        ),
      ],
    }
  }
  private makeConnection(config: McpServerConfig): Connection {
    const client = new Client(
      { name: 'oh-my-harness', version: '0.0.0' },
      { capabilities: {} },
    )
    return {
      config,
      client,
      controller: new AbortController(),
      status: MCP_CONNECTION_STATUS.CONNECTING,
      tools: [],
      active: new Set(),
    }
  }
  private async connect(config: McpServerConfig) {
    if (this.closed) return
    const document = await this.store.read()
    if (
      this.closed ||
      !document.servers.some(
        (server) =>
          server.id === config.id &&
          server.revision === config.revision &&
          server.enabled,
      )
    )
      return
    const existing = this.connections.get(config.id)
    if (existing) return existing.settled
    const connection = this.makeConnection(config)
    this.connections.set(config.id, connection)
    connection.settled = this.initialize(connection)
    await connection.settled
  }
  private async discover(connection: Connection) {
    const tools: Tool[] = [],
      cursors = new Set<string>(),
      names = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await connection.client.listTools(
        cursor ? { cursor } : undefined,
        { signal: connection.controller.signal, timeout: 10_000 },
      )
      for (const tool of page.tools) {
        if (
          names.has(tool.name) ||
          tool.name.length > 200 ||
          JSON.stringify(tool).length > 64 * 1024
        )
          throw new Error('invalid tool catalog')
        names.add(tool.name)
        tools.push(redactMcpValue(tool, knownSecrets(connection.config), false))
      }
      cursor = page.nextCursor
      if (
        tools.length > 1000 ||
        cursors.size >= 100 ||
        (cursor && cursors.has(cursor))
      )
        throw new Error('catalog limit')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    connection.controller.signal.throwIfAborted()
    connection.tools = tools
  }
  private async initialize(connection: Connection) {
    const { config, client } = connection
    const transport =
      config.transport === MCP_TRANSPORT.STDIO
        ? new StdioClientTransport({
            command: config.command!,
            args: config.args,
            cwd: homedir(),
            env: { ...getDefaultEnvironment(), ...config.env },
            stderr: 'ignore',
            maxBufferSize: 5 * 1024 * 1024,
          })
        : new StreamableHTTPClientTransport(new URL(config.url!), {
            requestInit: { headers: config.headers, redirect: 'error' },
            fetch: async (url, init) => {
              const response = await fetch(url, { ...init, redirect: 'error' })
              if (!response.body) return response
              let bytes = 0
              const body = response.body.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                  transform(chunk, controller) {
                    bytes += chunk.byteLength
                    if (bytes > 5 * 1024 * 1024)
                      throw new Error('MCP response too large')
                    controller.enqueue(chunk)
                  },
                }),
              )
              return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            },
            reconnectionOptions: {
              maxRetries: 0,
              initialReconnectionDelay: 1000,
              maxReconnectionDelay: 1000,
              reconnectionDelayGrowFactor: 1,
            },
          })
    const fail = (error?: unknown) => {
      if (connection.controller.signal.aborted) return
      connection.status = MCP_CONNECTION_STATUS.ERROR
      connection.error =
        connectionErrorMessage(error) ?? '连接已断开，请检查服务后重试。'
      connection.controller.abort()
      void client.close().catch(() => undefined)
    }
    client.onclose = fail
    client.onerror = fail
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        if (connection.discovering) return
        connection.discovering = this.discover(connection)
          .catch(fail)
          .finally(() => {
            connection.discovering = undefined
          })
        await connection.discovering
      },
    )
    const timeout = setTimeout(() => {
      connection.error =
        '连接或工具发现超时（10 秒），请检查网络和服务状态后重试。'
      connection.controller.abort()
      void client.close().catch(() => undefined)
    }, 10_000)
    try {
      await client.connect(transport, {
        signal: connection.controller.signal,
        timeout: 10_000,
      })
      await this.discover(connection)
      connection.status = MCP_CONNECTION_STATUS.CONNECTED
      connection.checkedAt = new Date().toISOString()
    } catch (error) {
      connection.status = MCP_CONNECTION_STATUS.ERROR
      connection.error =
        connectionErrorMessage(error) ??
        connection.error ??
        '连接失败：请检查地址、凭据、启动程序与环境；仅支持 stdio / Streamable HTTP。'
      connection.controller.abort()
      await client.close().catch(() => undefined)
      await transport.close().catch(() => undefined)
    } finally {
      clearTimeout(timeout)
    }
  }
  private async disconnect(id: string) {
    const connection = this.connections.get(id)
    if (!connection) return
    this.connections.delete(id)
    connection.controller.abort()
    await connection.client.close().catch(() => undefined)
    await connection.settled
  }
}
