import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  MCP_AUTH_METHOD,
  MCP_AUTH_SESSION_STATUS,
  MCP_AUTH_STATUS,
  MCP_ERROR_CODE,
  type McpAuthMethod,
  type McpAuthSessionStatus,
  type McpAuthStatus,
} from '@oh-my-harness/shared'
import {
  McpError,
  configObject,
  parseMcpServer,
  type McpServerConfig,
} from './config.ts'
import {
  atomicJson,
  privateDirectory,
  readJson,
  UUID_PATTERN,
} from './auth-store.ts'
import {
  parseAuthClients,
  parseAuthProfiles,
  type McpAuthProfile,
} from './auth-profile.ts'
import {
  startDeviceAuthorization,
  pollDeviceAuthorization,
  refreshDeviceAuthorization,
  type DeviceAuthorization,
} from './device-authorization.ts'

export interface McpAuthOptions {
  callbackUrl: string
  clientMetadataUrl?: string
  clients?: Record<string, { client_id: string; client_secret?: string }>
  profiles?: Record<string, McpAuthProfile>
  fetcher?: typeof fetch
}
export interface McpAuthInfo {
  status: McpAuthStatus
  method: McpAuthMethod
  accountName?: string
  error?: string
  credentialKeys: string[]
  setupUrl?: string
}
export interface McpAuthSession {
  id: string
  status: McpAuthSessionStatus
  expiresAt: number
  authorizationUrl?: string
  userCode?: string
  verificationUri?: string
  error?: string
}
interface Authorization {
  target: string
  tokens?: OAuthTokens
  expiresAt?: number
  client?: OAuthClientInformationMixed
  discovery?: OAuthDiscoveryState
  headers?: Record<string, string>
  env?: Record<string, string>
  reconnect?: boolean
  accountName?: string
  refreshExpiresAt?: number
}
interface Session extends McpAuthSession {
  serverId: string
  target: string
  verifier?: string
  state: string
  record: Authorization
  controller: AbortController
  consuming?: boolean
  generation: number
  device?: DeviceAuthorization
}
const loopback = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
const privateAddress = (address: string) =>
  /^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|224\.|240\.)/u.test(
    address,
  ) || /^(?:\[?::|f[cd]|fe[89ab])/iu.test(address)
const configTarget = (config: McpServerConfig) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        ...config,
        name: undefined,
        enabled: undefined,
        revision: undefined,
      }),
    )
    .digest('hex')
const failure = (message: string, status = 400) =>
  new McpError(MCP_ERROR_CODE.UNAVAILABLE, message, status)
/** 授权状态按 MCP ID 保存；SDK 负责协议，本类负责会话、持久化与失效边界。 */
export class McpAuth {
  private readonly starting = new Map<string, Promise<McpAuthSession>>()
  private readonly polling = new Set<Promise<void>>()
  private readonly records = new Map<string, Authorization>()
  private readonly sessions = new Map<string, Session>()
  private readonly refreshing = new Map<string, Promise<string | undefined>>()
  private readonly setupRequired = new Set<string>()
  private readonly challenges = new Map<
    string,
    ReturnType<typeof extractWWWAuthenticateParams>
  >()
  private readonly generations = new Map<string, number>()
  private pending: Promise<unknown> = Promise.resolve()
  private readonly ready: Promise<void>
  private corrupt = false
  private closed = false
  private onChanged: (id: string) => Promise<void> = async () => {}
  private configs = new Map<string, McpServerConfig>()
  private readonly directory: string
  private readonly options: McpAuthOptions
  constructor(directory: string, options: McpAuthOptions) {
    this.directory = directory
    this.options = {
      ...options,
      clients: parseAuthClients(options.clients ?? {}),
      profiles: parseAuthProfiles(options.profiles ?? {}),
    }
    this.ready = this.load()
  }

  /** 面向授权服务器发布本应用的公共客户端声明。 */
  clientMetadata() {
    return {
      client_id: this.options.clientMetadataUrl,
      client_name: 'oh-my-harness',
      redirect_uris: [this.options.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  private async load() {
    await privateDirectory(this.directory)
    try {
      const value = (await readJson(
        join(this.directory, 'authorizations.json'),
      )) as { version?: number; records?: Record<string, Authorization> }
      if (
        value.version !== 1 ||
        !value.records ||
        typeof value.records !== 'object' ||
        Array.isArray(value.records) ||
        Object.keys(value.records).length > 2100
      )
        throw Error('invalid auth store')
      for (const [id, record] of Object.entries(value.records)) {
        if (
          !UUID_PATTERN.test(id) ||
          !record ||
          typeof record.target !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(record.target) ||
          Object.keys(record).some(
            (key) =>
              ![
                'target',
                'tokens',
                'expiresAt',
                'client',
                'discovery',
                'headers',
                'env',
                'reconnect',
                'accountName',
                'refreshExpiresAt',
              ].includes(key),
          ) ||
          (record.expiresAt !== undefined &&
            !Number.isSafeInteger(record.expiresAt)) ||
          (record.reconnect !== undefined &&
            typeof record.reconnect !== 'boolean')
        )
          throw Error('invalid credential')
        if (
          record.accountName !== undefined &&
          (typeof record.accountName !== 'string' ||
            record.accountName.length > 100 ||
            /[\r\n\0]/u.test(record.accountName))
        )
          throw Error('invalid account')
        if (
          record.refreshExpiresAt !== undefined &&
          !Number.isSafeInteger(record.refreshExpiresAt)
        )
          throw Error('invalid expiry')
        if (record.tokens) OAuthTokensSchema.parse(record.tokens)
        if (record.client) OAuthClientInformationSchema.parse(record.client)
        if (record.headers)
          parseMcpServer('stored', {
            url: 'https://example.test/mcp',
            headers: record.headers,
          })
        if (record.env)
          parseMcpServer('stored', { command: 'stored', env: record.env })
        if (record.discovery) {
          if (!URL.canParse(record.discovery.authorizationServerUrl))
            throw Error('invalid discovery')
          if (record.discovery.authorizationServerMetadata)
            OAuthMetadataSchema.parse(
              record.discovery.authorizationServerMetadata,
            )
          if (record.discovery.resourceMetadata)
            OAuthProtectedResourceMetadataSchema.parse(
              record.discovery.resourceMetadata,
            )
        }
        this.records.set(id, record)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.corrupt = true
        this.records.clear()
      }
    }
  }
  private async usable() {
    await this.ready
    if (this.closed) throw failure('授权服务已关闭。', 503)
    if (this.corrupt) throw failure('授权数据无法读取，已保留原文件。', 500)
  }
  private async write(
    id: string,
    record?: Authorization,
    allowed: () => boolean = () => true,
  ) {
    const work = this.pending.then(async () => {
      await this.usable()
      if (!allowed()) throw failure('授权目标已变化，请重新连接。', 409)
      const records = new Map(this.records)
      if (record) records.set(id, structuredClone(record))
      else records.delete(id)
      await atomicJson(this.directory, 'authorizations.json', {
        version: 1,
        records: Object.fromEntries(records),
      })
      if (!allowed()) {
        records.delete(id)
        await atomicJson(this.directory, 'authorizations.json', {
          version: 1,
          records: Object.fromEntries(records),
        })
        this.records.delete(id)
        throw failure('授权已取消，迟到结果已丢弃。', 409)
      }
      this.records.clear()
      for (const [key, value] of records) this.records.set(key, value)
    })
    this.pending = work.catch(() => {})
    return work
  }
  /** 配置装配结束后绑定状态变化回调，不将令牌注入插件状态。 */
  setOnChanged(handler: (id: string) => Promise<void>) {
    this.onChanged = handler
  }
  /** 目标变更或卸载会使进行中授权失效；停用插件不会丢弃账号绑定。 */
  async reconcile(configs: McpServerConfig[], preserveMissing = false) {
    await this.usable()
    this.configs = new Map(configs.map((config) => [config.id, config]))
    for (const session of this.sessions.values()) {
      const config = this.configs.get(session.serverId)
      if (!config || this.target(config) !== session.target)
        this.cancelSession(session)
    }
    for (const [id, record] of this.records) {
      const config = this.configs.get(id)
      if (
        (!config && !preserveMissing) ||
        (config && this.target(config) !== record.target)
      ) {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
        // 配置暂缺或目标改变时仅禁止使用；显式删除服务才清理绑定。
        if (!config) await this.write(id)
      }
    }
  }
  private profile(config: McpServerConfig) {
    return this.options.profiles?.[config.url!]
  }
  /** 设备授权绑定管理员端点与自有客户端身份；配置切换后不能沿用旧令牌。 */
  private target(config: McpServerConfig) {
    const device = this.profile(config)?.device
    return device
      ? createHash('sha256')
          .update(
            JSON.stringify({
              config: configTarget(config),
              device,
              clientId: this.options.clients?.[config.url!]?.client_id,
            }),
          )
          .digest('hex')
      : configTarget(config)
  }
  private record(config: McpServerConfig) {
    const record = this.records.get(config.id)
    return record?.target === this.target(config) ? record : undefined
  }
  /** UI 仅得到状态、字段名和官方指引，不得到 Token、Client Secret 或 PKCE。 */
  info(config: McpServerConfig): McpAuthInfo {
    const record = this.record(config)
    const credentialKeys = config.url
      ? [
          config.bearer_token_env_var ?? '访问令牌',
          ...Object.keys(config.headers).filter(
            (key) => key !== 'authorization',
          ),
        ]
      : [
          ...new Set([
            ...(config.env_vars ?? []),
            ...Object.keys(config.env).filter((key) =>
              /\$\{|^<.+>$/u.test(config.env[key]),
            ),
          ]),
        ]
    const method = this.profile(config)?.device
      ? MCP_AUTH_METHOD.DEVICE
      : config.url
        ? MCP_AUTH_METHOD.OAUTH
        : MCP_AUTH_METHOD.CREDENTIALS
    if (this.corrupt)
      return {
        status: MCP_AUTH_STATUS.ERROR,
        method,
        credentialKeys,
        error: '授权数据无法读取，已保留原文件。',
      }
    if (record?.headers || record?.env)
      return {
        status: record.reconnect
          ? MCP_AUTH_STATUS.RECONNECT_REQUIRED
          : MCP_AUTH_STATUS.AUTHORIZED,
        method,
        credentialKeys,
      }
    if (
      method === MCP_AUTH_METHOD.DEVICE &&
      !this.options.clients?.[config.url!]
    )
      return {
        status: MCP_AUTH_STATUS.SETUP_REQUIRED,
        method,
        credentialKeys,
        error:
          '需要部署管理员配置本应用的 OAuth Client ID，并在服务商处开启 Device Flow。',
        setupUrl: this.profile(config)?.setupUrl,
      }
    if (
      [...this.sessions.values()].some(
        (session) =>
          session.serverId === config.id &&
          session.status === MCP_AUTH_SESSION_STATUS.AUTHORIZING &&
          session.expiresAt > Date.now(),
      )
    )
      return { status: MCP_AUTH_STATUS.AUTHORIZING, method, credentialKeys }
    if (record?.tokens)
      return {
        status:
          record.reconnect ||
          (record.refreshExpiresAt !== undefined &&
            record.refreshExpiresAt <= Date.now()) ||
          (record.expiresAt &&
            record.expiresAt <= Date.now() &&
            !record.tokens.refresh_token)
            ? MCP_AUTH_STATUS.RECONNECT_REQUIRED
            : MCP_AUTH_STATUS.AUTHORIZED,
        method,
        credentialKeys,
        accountName: record.accountName,
      }
    if (
      this.setupRequired.has(config.id) &&
      !this.options.clients?.[config.url!]
    )
      return {
        status: MCP_AUTH_STATUS.SETUP_REQUIRED,
        method,
        credentialKeys,
        error:
          '需要部署管理员为此服务配置本应用的 OAuth Client ID；服务商要求时还需 Client Secret。',
        setupUrl: this.profile(config)?.setupUrl,
      }
    return { status: MCP_AUTH_STATUS.NOT_CONNECTED, method, credentialKeys }
  }
  /** 发现文档、令牌端点与授权页面统一拒绝非 HTTPS 和私网目标。 */
  private async safeUrl(url: URL, allowLoopback = false) {
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw failure('授权服务地址不安全。')
    const hostname = url.hostname.replace(/^\[|\]$/gu, '')
    if (
      loopback(hostname)
        ? !allowLoopback
        : isIP(hostname) && privateAddress(hostname)
    )
      throw failure('授权服务不能访问本机或私有网络地址。')
    if (!this.options.fetcher && !loopback(hostname)) {
      const addresses = await lookup(hostname, { all: true })
      if (
        !addresses.length ||
        addresses.some(({ address }) => privateAddress(address))
      )
        throw failure('授权服务不能访问私有网络地址。')
    }
  }
  /** 限制授权请求响应体、时间与重定向，不回显服务端原始错误。 */
  private fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
    allowLoopback = false,
  ): Promise<Response> => {
    init?.signal?.throwIfAborted()
    await this.safeUrl(
      new URL(input instanceof Request ? input.url : String(input)),
      allowLoopback,
    )
    init?.signal?.throwIfAborted()
    const response = await (this.options.fetcher ?? fetch)(input, {
      ...init,
      redirect: 'error',
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    })
    const reader = response.body?.getReader()
    if (!reader) return response
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 1024 * 1024) throw failure('授权响应过大。')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    })
  }
  private provider(
    config: McpServerConfig,
    session: Session,
  ): OAuthClientProvider {
    const configured = this.options.clients?.[config.url!]
    const valid = () =>
      (this.generations.get(config.id) ?? 0) === session.generation &&
      !session.controller.signal.aborted &&
      !this.closed &&
      session.expiresAt > Date.now() &&
      this.target(this.configs.get(config.id) ?? config) === session.target &&
      this.configs.has(config.id)
    return {
      redirectUrl: this.options.callbackUrl,
      clientMetadataUrl: this.options.clientMetadataUrl,
      clientMetadata: {
        client_name: 'oh-my-harness',
        redirect_uris: [this.options.callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: configured?.client_secret
          ? 'client_secret_post'
          : 'none',
        ...(config.scopes ? { scope: config.scopes.join(' ') } : {}),
      },
      state: () => session.state,
      validateResourceURL: async (serverUrl, resource) => {
        const server = new URL(serverUrl),
          selected = new URL(resource ?? config.oauth_resource ?? serverUrl)
        if (
          selected.origin !== server.origin ||
          !(
            server.pathname === selected.pathname ||
            server.pathname.startsWith(
              selected.pathname.replace(/\/$/u, '') + '/',
            )
          )
        )
          throw failure('OAuth 资源标识与 MCP 服务不匹配。')
        return selected
      },
      clientInformation: () => configured ?? session.record.client,
      saveClientInformation: async (client) => {
        if (!valid()) throw failure('授权已取消。')
        session.record.client = client
        await this.write(
          config.id,
          {
            ...session.record,
            ...this.record(config),
            client,
            discovery: session.record.discovery,
          },
          valid,
        )
      },
      discoveryState: () => session.record.discovery,
      saveDiscoveryState: async (discovery) => {
        if (!valid()) throw failure('授权已取消。')
        const issuer = discovery.authorizationServerMetadata?.issuer
        if (
          issuer &&
          new URL(issuer).href !==
            new URL(discovery.authorizationServerUrl).href
        )
          throw failure('授权服务器标识不匹配。')
        session.record.discovery = discovery
      },
      tokens: () => session.record.tokens,
      saveTokens: async (tokens) => {
        if (!valid()) throw failure('授权已取消。')
        OAuthTokensSchema.parse(tokens)
        if (
          !/^Bearer$/iu.test(tokens.token_type) ||
          /[\r\n\0]/u.test(tokens.access_token) ||
          (tokens.expires_in !== undefined &&
            (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0))
        )
          throw failure('授权凭据格式无效。')
        session.record.tokens = {
          ...tokens,
          refresh_token:
            tokens.refresh_token ?? session.record.tokens?.refresh_token,
        }
        session.record.expiresAt = tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined
        const refreshLifetime = (tokens as Record<string, unknown>)
          .refresh_token_expires_in
        if (refreshLifetime !== undefined) {
          if (
            !Number.isSafeInteger(refreshLifetime) ||
            Number(refreshLifetime) <= 0 ||
            Number(refreshLifetime) > 365 * 86400
          )
            throw failure('刷新令牌有效期无效。')
          session.record.refreshExpiresAt =
            Date.now() + Number(refreshLifetime) * 1000
        }
        session.record.reconnect = false
        await this.write(config.id, session.record, valid)
      },
      redirectToAuthorization: async (url) => {
        if (!valid()) throw failure('授权已取消。')
        await this.safeUrl(url, loopback(new URL(config.url!).hostname))
        if (!valid()) throw failure('授权已取消。')
        for (const [key, value] of Object.entries(
          this.profile(config)?.authorizationParams ?? {},
        ))
          url.searchParams.set(key, value)
        session.authorizationUrl = url.href
      },
      saveCodeVerifier: (verifier) => {
        session.verifier = verifier
      },
      codeVerifier: () => {
        if (!valid() || !session.verifier) throw failure('授权会话已失效。')
        return session.verifier
      },
      invalidateCredentials: (scope) => {
        if (scope === 'all' || scope === 'tokens') delete session.record.tokens
        if (scope === 'all' || scope === 'client') delete session.record.client
        if (scope === 'all' || scope === 'discovery')
          delete session.record.discovery
      },
    }
  }
  private publicSession(session: Session): McpAuthSession {
    return {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      authorizationUrl: session.authorizationUrl,
      error: session.error,
      userCode: session.device?.userCode,
      verificationUri: session.device?.verificationUri,
    }
  }
  private cancelSession(session: Session) {
    session.controller.abort()
    session.status = MCP_AUTH_SESSION_STATUS.CANCELLED
    session.verifier = undefined
  }
  /** 同一服务重复点击复用启动请求；所有协议共用会话和取消边界。 */
  async start(
    config: McpServerConfig,
    signal?: AbortSignal,
  ): Promise<McpAuthSession> {
    signal?.throwIfAborted()
    const existing = this.starting.get(config.id)
    if (existing) return existing
    const work = this.startNew(config, signal).finally(() =>
      this.starting.delete(config.id),
    )
    this.starting.set(config.id, work)
    return work
  }
  private async startNew(
    config: McpServerConfig,
    signal?: AbortSignal,
  ): Promise<McpAuthSession> {
    signal?.throwIfAborted()
    await this.usable()
    this.configs.set(config.id, config)
    if (!config.url) throw failure('本地服务请配置所需环境变量。')
    const info = this.info(config)
    if (info.status === MCP_AUTH_STATUS.SETUP_REQUIRED)
      throw failure(info.error!)
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= Date.now()) {
        this.cancelSession(session)
        this.sessions.delete(id)
      }
    const existing = [...this.sessions.values()].find(
      (session) =>
        session.serverId === config.id &&
        session.status === MCP_AUTH_SESSION_STATUS.AUTHORIZING,
    )
    if (existing) return this.publicSession(existing)
    if (this.sessions.size >= 100)
      throw failure('授权会话过多，请稍后重试。', 429)
    const session: Session = {
      id: randomUUID(),
      generation: this.generations.get(config.id) ?? 0,
      serverId: config.id,
      state: randomUUID(),
      target: this.target(config),
      record: {
        ...structuredClone(this.record(config) ?? {}),
        target: this.target(config),
        tokens: undefined,
      },
      expiresAt: Date.now() + 10 * 60_000,
      status: MCP_AUTH_SESSION_STATUS.AUTHORIZING,
      controller: new AbortController(),
    }
    this.sessions.set(session.id, session)
    const abort = () => this.cancelSession(session)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const device = this.profile(config)?.device
      if (device) {
        session.device = await startDeviceAuthorization(
          device,
          this.options.clients![config.url]!,
          this.fetcher,
          session.controller.signal,
        )
        session.expiresAt = session.device.expiresAt
        session.controller.signal.throwIfAborted()
        const work = this.finishDevice(config, session).finally(() =>
          this.polling.delete(work),
        )
        this.polling.add(work)
        return this.publicSession(session)
      }
      await auth(this.provider(config, session), {
        serverUrl: config.url,
        fetchFn: async (input, init) => {
          const response = await this.fetcher(
            input,
            { ...init, signal: session.controller.signal },
            loopback(new URL(config.url!).hostname),
          )
          if (
            [401, 403].includes(response.status) &&
            String(input) ===
              session.record.discovery?.authorizationServerMetadata
                ?.registration_endpoint
          )
            throw failure(
              `服务商拒绝本应用注册（HTTP ${response.status}）。请由管理员确认应用接入资格或配置已获准的 OAuth 客户端。`,
            )
          return response
        },
        scope:
          this.challenges.get(config.id)?.scope ?? config.scopes?.join(' '),
        resourceMetadataUrl: this.challenges.get(config.id)
          ?.resourceMetadataUrl,
      })
      return this.publicSession(session)
    } catch (error) {
      const metadata = session.record.discovery?.authorizationServerMetadata
      if (
        metadata &&
        !metadata.registration_endpoint &&
        !this.options.clients?.[config.url] &&
        !(
          metadata.client_id_metadata_document_supported &&
          this.options.clientMetadataUrl
        )
      )
        this.setupRequired.add(config.id)
      if (session.status === MCP_AUTH_SESSION_STATUS.AUTHORIZING) {
        session.status = MCP_AUTH_SESSION_STATUS.ERROR
        session.error =
          error instanceof McpError
            ? error.message
            : '无法开始授权。请检查网络及服务商应用注册；也可使用手动凭据。'
      }
      return this.publicSession(session)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
  /** 设备轮询完成后复用 OAuth 凭据保存，不建立第二套状态或令牌文件。 */
  private async finishDevice(config: McpServerConfig, session: Session) {
    try {
      const device = this.profile(config)!.device!
      const tokens = await pollDeviceAuthorization(
        session.device!,
        device,
        this.options.clients![config.url!]!,
        this.fetcher,
        session.controller.signal,
      )
      session.controller.signal.throwIfAborted()
      if (
        !/^Bearer$/iu.test(tokens.token_type) ||
        /[\r\n\0]/u.test(tokens.access_token)
      )
        throw failure('授权凭据格式无效。')
      if (device.account) {
        const response = await this.fetcher(device.account.url, {
          signal: session.controller.signal,
          headers: {
            ...device.account.headers,
            Authorization: `Bearer ${tokens.access_token}`,
          },
        })
        if (!response.ok) throw failure('无法确认授权账号，请重试。')
        const account = configObject(await response.json())[
          device.account.nameField
        ]
        if (
          typeof account !== 'string' ||
          !account ||
          account.length > 100 ||
          /[\r\n\0]/u.test(account)
        )
          throw failure('授权账号响应无效。')
        session.record.accountName = account
      }
      await this.provider(config, session).saveTokens(tokens)
      session.status = MCP_AUTH_SESSION_STATUS.AUTHORIZED
      await this.onChanged(config.id)
    } catch (error) {
      if (!session.controller.signal.aborted) {
        session.status =
          session.expiresAt <= Date.now()
            ? MCP_AUTH_SESSION_STATUS.EXPIRED
            : MCP_AUTH_SESSION_STATUS.ERROR
        session.error =
          error instanceof McpError
            ? error.message
            : '设备授权未完成，请重新连接。'
      }
    } finally {
      session.device = undefined
    }
  }
  /** 一次性回调：先校验 state、目标、期限和 issuer，再交换授权码。 */
  async callback(params: URLSearchParams) {
    await this.usable()
    for (const key of ['state', 'code', 'iss', 'error'])
      if (params.getAll(key).length > 1) throw failure('授权回调参数重复。')
    const session = [...this.sessions.values()].find(
      (item) => item.state === params.get('state'),
    )
    if (
      !session ||
      session.device ||
      session.consuming ||
      session.status !== MCP_AUTH_SESSION_STATUS.AUTHORIZING ||
      session.expiresAt <= Date.now()
    )
      throw failure('授权会话已过期或已使用，请返回应用重试。')
    const config = this.configs.get(session.serverId)
    if (!config || this.target(config) !== session.target)
      throw failure('服务配置已变化，请重新连接。')
    const metadata = session.record.discovery?.authorizationServerMetadata
    if (
      (params.has('iss') ||
        (metadata as Record<string, unknown> | undefined)
          ?.authorization_response_iss_parameter_supported) &&
      params.get('iss') !== metadata?.issuer
    )
      throw failure('授权回调来源不匹配。')
    session.consuming = true
    try {
      if (
        params.has('error') ||
        !params.get('code') ||
        params.get('code')!.length > 8192
      )
        throw failure('授权未完成或已被拒绝。')
      await auth(this.provider(config, session), {
        serverUrl: config.url!,
        authorizationCode: params.get('code')!,
        fetchFn: (input, init) =>
          this.fetcher(
            input,
            { ...init, signal: session.controller.signal },
            loopback(new URL(config.url!).hostname),
          ),
      })
      session.status = MCP_AUTH_SESSION_STATUS.AUTHORIZED
      await this.onChanged(config.id)
    } catch {
      session.status = MCP_AUTH_SESSION_STATUS.ERROR
      session.error = '授权未完成，请返回应用重试。'
      throw failure(session.error)
    } finally {
      session.verifier = undefined
    }
  }
  async session(config: McpServerConfig, id: string): Promise<McpAuthSession> {
    const session = this.sessions.get(id)
    if (!session || session.serverId !== config.id)
      throw failure('授权会话不存在。', 404)
    if (
      session.expiresAt <= Date.now() &&
      session.status === MCP_AUTH_SESSION_STATUS.AUTHORIZING
    ) {
      this.cancelSession(session)
      session.status = MCP_AUTH_SESSION_STATUS.EXPIRED
    }
    return this.publicSession(session)
  }
  async cancel(config: McpServerConfig, id: string) {
    await this.session(config, id)
    this.cancelSession(this.sessions.get(id)!)
  }
  /** 手动凭据只允许写入已声明的字段，不向客户端回读。 */
  async credentials(config: McpServerConfig, value: unknown) {
    const input = value as Record<string, unknown>
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !['token', 'headers', 'env'].includes(key),
      )
    )
      throw failure('凭据字段无效。')
    const headers = configObject(input.headers ?? {}),
      env = configObject(input.env ?? {})
    if (
      (config.url && Object.keys(env).length) ||
      (!config.url && (Object.keys(headers).length || input.token))
    )
      throw failure('凭据类型与传输方式不匹配。')
    if (input.token !== undefined && typeof input.token !== 'string')
      throw failure('令牌格式无效。')
    const parsed = parseMcpServer(
      config.name,
      config.url
        ? {
            url: config.url,
            headers: {
              ...(headers as object),
              ...(input.token
                ? { Authorization: `Bearer ${input.token}` }
                : {}),
            },
          }
        : { command: config.command, args: config.args, env },
    )
    if (
      !config.url &&
      Object.keys(parsed.env).some(
        (key) =>
          ![...(config.env_vars ?? []), ...Object.keys(config.env)].includes(
            key,
          ),
      )
    )
      throw failure('环境变量未在服务配置中声明。')
    if (!Object.keys(parsed.headers).length && !Object.keys(parsed.env).length)
      throw failure('请填写凭据后保存。')
    this.generations.set(config.id, (this.generations.get(config.id) ?? 0) + 1)
    for (const session of this.sessions.values())
      if (session.serverId === config.id) this.cancelSession(session)
    await this.write(config.id, {
      target: this.target(config),
      ...(config.url ? { headers: parsed.headers } : { env: parsed.env }),
    })
    await this.onChanged(config.id)
  }
  async disconnect(config: McpServerConfig) {
    this.generations.set(config.id, (this.generations.get(config.id) ?? 0) + 1)
    for (const session of this.sessions.values())
      if (session.serverId === config.id) this.cancelSession(session)
    await this.write(config.id)
    await this.onChanged(config.id)
  }
  /** 连接与工具调用前取得凭据；刷新单飞，401 不会重放工具调用。 */
  async authorization(config: McpServerConfig): Promise<string | undefined> {
    await this.usable()
    const record = this.record(config)
    if (record?.headers?.authorization) return record.headers.authorization
    if (!record?.tokens || record.reconnect) return undefined
    if (!record.expiresAt || record.expiresAt > Date.now() + 60_000)
      return `Bearer ${record.tokens.access_token}`
    const ongoing = this.refreshing.get(config.id)
    if (ongoing) return ongoing
    const work = (async () => {
      if (
        !record.tokens?.refresh_token ||
        (record.refreshExpiresAt !== undefined &&
          record.refreshExpiresAt <= Date.now())
      ) {
        await this.write(config.id, { ...record, reconnect: true })
        return undefined
      }
      const session: Session = {
        id: randomUUID(),
        generation: this.generations.get(config.id) ?? 0,
        serverId: config.id,
        target: this.target(config),
        state: randomUUID(),
        record: structuredClone(record),
        expiresAt: Date.now() + 60_000,
        status: MCP_AUTH_SESSION_STATUS.AUTHORIZING,
        controller: new AbortController(),
      }
      try {
        const device = this.profile(config)?.device
        if (device) {
          const client = this.options.clients?.[config.url!]
          if (!client) throw failure('缺少设备授权客户端配置。')
          const tokens = await refreshDeviceAuthorization(
            device,
            client,
            record.tokens!.refresh_token!,
            this.fetcher,
            session.controller.signal,
          )
          await this.provider(config, session).saveTokens(tokens)
          return `Bearer ${session.record.tokens!.access_token}`
        }
        const result = await auth(this.provider(config, session), {
          serverUrl: config.url!,
          fetchFn: (input, init) =>
            this.fetcher(input, init, loopback(new URL(config.url!).hostname)),
        })
        if (result !== 'AUTHORIZED') throw failure('需要重新登录。')
        return `Bearer ${session.record.tokens!.access_token}`
      } catch {
        if (this.record(config) === record)
          await this.write(config.id, { ...record, reconnect: true })
        return undefined
      }
    })().finally(() => this.refreshing.delete(config.id))
    this.refreshing.set(config.id, work)
    return work
  }
  /** 记录服务端挑战，失效授权只提示重连，绝不重放当前工具请求。 */
  async rejected(config: McpServerConfig, response: Response) {
    if (response.status !== 401) return
    this.challenges.set(config.id, extractWWWAuthenticateParams(response))
    const record = this.record(config)
    if (record) await this.write(config.id, { ...record, reconnect: true })
  }

  /** 动态构造传输凭据，保持持久化服务定义不包含 OAuth Token。 */
  async connectionConfig(config: McpServerConfig): Promise<McpServerConfig> {
    const authorization = await this.authorization(config)
    const record = this.record(config)
    const env = Object.fromEntries(
      Object.entries(config.env).filter(
        ([, value]) => !/\$\{|^<.+>$/u.test(value),
      ),
    )
    return {
      ...config,
      env: { ...env, ...record?.env },
      headers: {
        ...Object.fromEntries(
          Object.entries(config.headers).filter(
            ([, value]) => !/\$\{|^<.+>$/u.test(value),
          ),
        ),
        ...record?.headers,
        ...(authorization ? { authorization } : {}),
      },
    }
  }
  async close() {
    this.closed = true
    for (const session of this.sessions.values()) this.cancelSession(session)
    await Promise.allSettled([...this.starting.values(), ...this.polling])
    await Promise.allSettled(this.refreshing.values())
    await this.pending
  }
}
