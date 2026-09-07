import { createHash, randomUUID } from 'node:crypto'
import {
  auth,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {
  McpServerDefinition,
  PluginSnapshot,
} from '@oh-my-harness/agent-plugins'
import { createMcpFetch, validateMcpUrl } from './network.ts'

export type McpConnectionTarget = {
  id: string
  installationId: string
  rootDirectory: string
  definition: McpServerDefinition
}
export type McpConnectionSettings = {
  allowed: boolean
  environment?: Record<string, string>
  clientId?: string
  clientSecret?: string
  clientMetadataUrl?: string
  scope?: string
}
export type McpCredentialRecord = {
  binding: string
  generation: string
  settings: McpConnectionSettings
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  expiresAt?: number
  discovery?: OAuthDiscoveryState
  authRequired?: boolean
}
export interface McpCredentialStore {
  read(id: string): Promise<McpCredentialRecord | undefined>
  write(id: string, value: McpCredentialRecord | undefined): Promise<void>
}
type OAuthSession = {
  id: string
  connectionId: string
  generation: string
  state: string
  status: 'pending' | 'authorized' | 'failed' | 'cancelled' | 'expired'
  authorizationUrl?: string
  expiresAt: number
  verifier?: string
  consumed: boolean
  controller: AbortController
  target: McpConnectionTarget
}
export type McpConnectionStatus = {
  id: string
  installationId: string
  serverName: string
  transport: 'stdio' | 'http'
  endpoint?: string
  allowed: boolean
  configuredKeys: string[]
  requiredKeys: string[]
  authStatus:
    | 'not-required'
    | 'disconnected'
    | 'authorizing'
    | 'authorized'
    | 'reauth-required'
  connectionStatus: 'disconnected' | 'connecting' | 'ready' | 'error'
  message?: string
}

/** 由固定插件版本派生连接目标，禁止复用其他安装的身份。 */
export function pluginConnectionTargets(
  plugins: readonly PluginSnapshot[],
): McpConnectionTarget[] {
  return plugins.flatMap((plugin) =>
    plugin.activeRevision.descriptor.servers.map((definition) => ({
      id: `${plugin.id}:${definition.name}`,
      installationId: plugin.id,
      rootDirectory: plugin.rootDirectory,
      definition,
    })),
  )
}

const binding = (target: McpConnectionTarget) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        installationId: target.installationId,
        definition: target.definition,
      }),
    )
    .digest('hex')

/** 管理连接身份、OAuth 会话、凭据轮换与即时断开。 */
export class McpConnectionService {
  private readonly store: McpCredentialStore
  readonly redirectUrl: string
  private readonly sessions = new Map<string, OAuthSession>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly states = new Map<
    string,
    Pick<McpConnectionStatus, 'connectionStatus' | 'message'>
  >()
  private readonly revoked = new Set<string>()
  private readonly active = new Map<string, Set<() => void>>()

  constructor(store: McpCredentialStore, redirectUrl: string) {
    const url = new URL(redirectUrl)
    validateMcpUrl(
      redirectUrl,
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ? url.origin
        : undefined,
    )
    this.store = store
    this.redirectUrl = redirectUrl
  }

  private async locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.locks.get(id) ?? Promise.resolve()).then(
      operation,
      operation,
    )
    this.locks.set(id, task)
    try {
      return await task
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id)
    }
  }

  async configure(
    target: McpConnectionTarget,
    settings: McpConnectionSettings,
  ) {
    this.revoke(target.id)
    await this.locked(target.id, async () => {
      await this.store.write(target.id, {
        binding: binding(target),
        generation: randomUUID(),
        settings,
      })
      this.revoked.delete(target.id)
      this.states.delete(target.id)
    })
  }

  private revoke(id: string) {
    this.revoked.add(id)
    for (const session of this.sessions.values())
      if (session.connectionId === id && session.status === 'pending')
        this.cancelOAuth(session.id)
    for (const abort of this.active.get(id) ?? []) abort()
  }

  async disconnect(id: string) {
    this.revoke(id)
    await this.locked(id, () => this.store.write(id, undefined))
    this.states.delete(id)
    return {
      message:
        '已断开并清除本地凭据；如需撤销服务商授权，请前往服务商账户设置。',
    }
  }

  async status(target: McpConnectionTarget): Promise<McpConnectionStatus> {
    const saved = await this.store.read(target.id)
    const record =
      saved?.binding === binding(target) && !this.revoked.has(target.id)
        ? saved
        : undefined
    const vars = [
      ...JSON.stringify(target.definition).matchAll(
        /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g,
      ),
    ]
      .map((match) => match[1])
      .filter(
        (key) =>
          !['CLAUDE_PLUGIN_ROOT', 'CODEX_PLUGIN_ROOT', 'PLUGIN_ROOT'].includes(
            key,
          ),
      )
    const pending = [...this.sessions.values()].some(
      (session) =>
        session.connectionId === target.id &&
        this.sessionStatus(session) === 'pending',
    )
    const url = target.definition.url
    let endpoint: string | undefined
    try {
      if (url) {
        const parsed = new URL(url)
        endpoint = `${parsed.origin}${parsed.pathname}`
      }
    } catch {
      /* templated endpoint */
    }
    return {
      id: target.id,
      installationId: target.installationId,
      serverName: target.definition.name,
      transport: target.definition.transport,
      endpoint,
      allowed: record?.settings.allowed ?? false,
      configuredKeys: Object.keys(record?.settings.environment ?? {}),
      requiredKeys: [...new Set(vars)],
      authStatus:
        target.definition.transport === 'stdio'
          ? 'not-required'
          : pending
            ? 'authorizing'
            : record?.tokens
              ? 'authorized'
              : record?.discovery
                ? 'reauth-required'
                : record?.authRequired === false
                  ? 'not-required'
                  : record?.authRequired
                    ? 'reauth-required'
                    : 'disconnected',
      ...(this.states.get(target.id) ?? { connectionStatus: 'disconnected' }),
    }
  }

  async redact<T>(id: string, value: T): Promise<T> {
    const record = await this.store.read(id)
    const secrets = [
      record?.tokens?.access_token,
      record?.tokens?.refresh_token,
      record?.settings.clientSecret,
      record?.client?.client_secret,
      ...Object.values(record?.settings.environment ?? {}),
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    const scrub = (item: unknown): unknown => {
      if (typeof item === 'string')
        return secrets.reduce(
          (text, secret) => text.replaceAll(secret, '[REDACTED]'),
          item,
        )
      if (Array.isArray(item)) return item.map(scrub)
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, scrub(value)]),
        )
      return item
    }
    return scrub(value) as T
  }

  private async requireRecord(
    target: McpConnectionTarget,
    generation?: string,
  ) {
    const record = await this.store.read(target.id)
    if (
      this.revoked.has(target.id) ||
      !record?.settings.allowed ||
      record.binding !== binding(target) ||
      (generation && record.generation !== generation)
    )
      throw new Error('MCP 连接未配置、已断开或配置已变化')
    return record
  }

  async configuration(target: McpConnectionTarget) {
    const record = await this.requireRecord(target)
    const expand = (value: string) =>
      value.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
        if (
          ['CLAUDE_PLUGIN_ROOT', 'CODEX_PLUGIN_ROOT', 'PLUGIN_ROOT'].includes(
            key,
          )
        )
          return target.rootDirectory
        const name = key.replace(/^env:/, '')
        const value = record.settings.environment?.[name]
        if (value === undefined) throw new Error(`MCP 需要配置环境变量 ${name}`)
        return value
      })
    const definition = target.definition
    const config = {
      ...definition,
      command: definition.command && expand(definition.command),
      args: definition.args?.map(expand),
      env: Object.fromEntries(
        Object.entries(definition.env ?? {}).map(([key, value]) => [
          key,
          expand(value),
        ]),
      ),
      url: definition.url && expand(definition.url),
      headers: Object.fromEntries(
        Object.entries(definition.headers ?? {}).map(([key, value]) => [
          key,
          expand(value),
        ]),
      ),
    }
    return { config, generation: record.generation }
  }

  private network(url: string) {
    const parsed = new URL(url)
    return createMcpFetch(
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        ? parsed.origin
        : undefined,
    )
  }

  private provider(
    target: McpConnectionTarget,
    record: McpCredentialRecord,
    session: OAuthSession,
  ): OAuthClientProvider {
    const save = async () => {
      session.controller.signal.throwIfAborted()
      await this.requireRecord(target, record.generation)
      session.controller.signal.throwIfAborted()
      await this.store.write(target.id, record)
      if (session.controller.signal.aborted) {
        record.tokens = undefined
        record.expiresAt = undefined
        await this.store.write(target.id, record)
        session.controller.signal.throwIfAborted()
      }
    }
    return {
      redirectUrl: this.redirectUrl,
      clientMetadataUrl: record.settings.clientMetadataUrl,
      clientMetadata: {
        client_name: 'oh-my-harness',
        redirect_uris: [this.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: record.settings.clientSecret
          ? 'client_secret_post'
          : 'none',
        ...(record.settings.scope ? { scope: record.settings.scope } : {}),
      },
      state: () => session.state,
      clientInformation: () =>
        record.client ??
        (record.settings.clientId
          ? {
              client_id: record.settings.clientId,
              ...(record.settings.clientSecret
                ? { client_secret: record.settings.clientSecret }
                : {}),
            }
          : undefined),
      saveClientInformation: async (client) => {
        record.client = client
        await save()
      },
      tokens: () => record.tokens,
      saveTokens: async (tokens) => {
        record.tokens = tokens
        record.authRequired = true
        record.expiresAt =
          tokens.expires_in === undefined
            ? undefined
            : Date.now() + tokens.expires_in * 1000
        await save()
      },
      redirectToAuthorization: (url) => {
        if (
          url.protocol !== 'https:' &&
          url.origin !== new URL(target.definition.url!).origin
        )
          throw new Error('无效 OAuth 授权地址')
        session.authorizationUrl = url.href
      },
      saveCodeVerifier: (verifier) => {
        session.verifier = verifier
      },
      codeVerifier: () => {
        if (!session.verifier) throw new Error('OAuth 会话已失效')
        return session.verifier
      },
      discoveryState: () => record.discovery,
      saveDiscoveryState: async (discovery) => {
        if (
          record.discovery &&
          record.discovery.authorizationServerUrl !==
            discovery.authorizationServerUrl
        ) {
          record.tokens = undefined
          record.client = undefined
        }
        record.discovery = discovery
        await save()
      },
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'tokens') {
          record.tokens = undefined
          record.expiresAt = undefined
        }
        if (scope === 'all' || scope === 'client') record.client = undefined
        if (scope === 'all' || scope === 'discovery')
          record.discovery = undefined
        if (scope === 'all' || scope === 'verifier')
          session.verifier = undefined
        await save()
      },
    }
  }

  async startOAuth(target: McpConnectionTarget) {
    if (target.definition.transport !== 'http')
      throw new Error('stdio 不使用 HTTP OAuth')
    for (const [id, session] of this.sessions)
      if (session.expiresAt < Date.now() - 60_000) this.sessions.delete(id)
    if (this.sessions.size >= 100) throw new Error('OAuth 会话过多，请稍后重试')
    for (const session of this.sessions.values())
      if (session.connectionId === target.id && session.status === 'pending')
        this.cancelOAuth(session.id)
    return this.locked(target.id, async () => {
      const { config, generation } = await this.configuration(target)
      const record = await this.requireRecord(target, generation)
      const session: OAuthSession = {
        id: randomUUID(),
        connectionId: target.id,
        generation,
        state: randomUUID(),
        status: 'pending',
        expiresAt: Date.now() + 10 * 60_000,
        consumed: false,
        controller: new AbortController(),
        target,
      }
      this.sessions.set(session.id, session)
      try {
        const fetcher = this.network(config.url!)
        const result = await auth(this.provider(target, record, session), {
          serverUrl: config.url!,
          scope: record.settings.scope,
          fetchFn: (input, init) =>
            fetcher(input, {
              ...init,
              signal: AbortSignal.any([
                session.controller.signal,
                AbortSignal.timeout(30_000),
              ]),
            }),
        })
        session.controller.signal.throwIfAborted()
        if (result === 'AUTHORIZED') session.status = 'authorized'
      } catch {
        session.status = session.controller.signal.aborted
          ? 'cancelled'
          : 'failed'
        session.verifier = undefined
      }
      return this.oauthStatus(session.id)
    })
  }

  private sessionStatus(session: OAuthSession) {
    if (session.status === 'pending' && session.expiresAt < Date.now()) {
      session.status = 'expired'
      session.controller.abort()
      session.verifier = undefined
    }
    return session.status
  }

  oauthStatus(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('OAuth 会话不存在')
    return {
      id,
      connectionId: session.connectionId,
      status: this.sessionStatus(session),
      expiresAt: session.expiresAt,
      ...(session.status === 'pending' && session.authorizationUrl
        ? { authorizationUrl: session.authorizationUrl }
        : {}),
    }
  }

  cancelOAuth(id: string) {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'pending') return
    session.status = 'cancelled'
    session.verifier = undefined
    session.controller.abort()
  }

  async callback(state: string, code?: string, denied = false) {
    const session = [...this.sessions.values()].find(
      (session) => session.state === state,
    )
    if (
      !session ||
      this.sessionStatus(session) !== 'pending' ||
      session.consumed
    )
      throw new Error('OAuth state 无效、已消费或过期')
    session.consumed = true
    if (denied || !code) {
      session.status = 'failed'
      session.verifier = undefined
      return
    }
    await this.locked(session.connectionId, async () => {
      try {
        const record = await this.requireRecord(
          session.target,
          session.generation,
        )
        const { config } = await this.configuration(session.target)
        const fetcher = this.network(config.url!)
        const result = await auth(
          this.provider(session.target, record, session),
          {
            serverUrl: config.url!,
            authorizationCode: code,
            fetchFn: (input, init) =>
              fetcher(input, { ...init, signal: session.controller.signal }),
          },
        )
        session.controller.signal.throwIfAborted()
        session.status = result === 'AUTHORIZED' ? 'authorized' : 'failed'
      } catch {
        session.status = session.controller.signal.aborted
          ? 'cancelled'
          : 'failed'
      } finally {
        session.verifier = undefined
        session.authorizationUrl = undefined
      }
    })
  }

  async requestFetch(target: McpConnectionTarget, generation: string) {
    const { config } = await this.configuration(target)
    const fetcher = this.network(config.url!)
    const fetchWithAuth: typeof fetch = async (input, init) => {
      const requested = new URL(
        input instanceof Request ? input.url : String(input),
      )
      if (requested.href !== new URL(config.url!).href)
        throw new Error('MCP 凭据不能发送到其他资源地址')
      const token = await this.locked(target.id, async () => {
        const record = await this.requireRecord(target, generation)
        if (
          record.tokens &&
          record.expiresAt !== undefined &&
          record.expiresAt < Date.now() + 30_000
        ) {
          if (!record.tokens.refresh_token || !record.discovery)
            throw new Error('MCP 需要重新认证')
          try {
            const tokens = await refreshAuthorization(
              record.discovery.authorizationServerUrl,
              {
                metadata: record.discovery.authorizationServerMetadata,
                clientInformation: record.client ?? {
                  client_id: record.settings.clientId!,
                },
                refreshToken: record.tokens.refresh_token,
                resource: new URL(
                  record.discovery.resourceMetadata?.resource ?? config.url!,
                ),
                fetchFn: fetcher,
              },
            )
            await this.requireRecord(target, generation)
            record.tokens = tokens
            record.expiresAt =
              tokens.expires_in === undefined
                ? undefined
                : Date.now() + tokens.expires_in * 1000
            await this.store.write(target.id, record)
          } catch {
            record.tokens = undefined
            record.expiresAt = undefined
            await this.store.write(target.id, record)
            throw new Error('MCP 需要重新认证')
          }
        }
        return record.tokens?.access_token
      })
      await this.requireRecord(target, generation)
      const headers = new Headers(init?.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await fetcher(input, { ...init, headers })
      if (response.status === 401) {
        await this.locked(target.id, async () => {
          const record = await this.requireRecord(target, generation)
          record.authRequired = true
          if (record.tokens?.access_token === token) {
            record.tokens = undefined
            record.expiresAt = undefined
          }
          await this.store.write(target.id, record)
        })
        this.states.set(target.id, {
          connectionStatus: 'error',
          message: '需要登录或重新授权；未自动重试调用',
        })
      } else if (response.ok && !token) {
        await this.locked(target.id, async () => {
          const record = await this.requireRecord(target, generation)
          if (record.authRequired !== false) {
            record.authRequired = false
            await this.store.write(target.id, record)
          }
        })
      }
      return response
    }
    return fetchWithAuth
  }

  watch(target: McpConnectionTarget, generation: string, abort: () => void) {
    const callbacks = this.active.get(target.id) ?? new Set<() => void>()
    callbacks.add(abort)
    this.active.set(target.id, callbacks)
    return {
      check: () => this.requireRecord(target, generation).then(() => undefined),
      release: () => {
        callbacks.delete(abort)
        if (!callbacks.size) this.active.delete(target.id)
      },
    }
  }

  setNetworkState(
    id: string,
    state: 'disconnected' | 'connecting' | 'ready' | 'error',
    message?: string,
  ) {
    this.states.set(id, { connectionStatus: state, message })
  }
  close() {
    for (const session of this.sessions.values()) this.cancelOAuth(session.id)
    for (const callbacks of this.active.values())
      for (const abort of callbacks) abort()
  }
}
