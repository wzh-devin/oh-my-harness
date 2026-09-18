import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  MCP_CHANGE_KIND,
  MCP_ERROR_CODE,
  MCP_TRANSPORT,
  type McpErrorCode,
  type McpTransport,
} from '@oh-my-harness/shared'

export class McpError extends Error {
  readonly code: McpErrorCode
  readonly status: number
  constructor(code: McpErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'McpError'
    this.code = code
    this.status = status
  }
}

export interface McpAuthorizationConfig {
  scopes?: string[]
  oauth_resource?: string
  bearer_token_env_var?: string
  oauth?: { client_id?: string; client_secret?: string; callback_port?: number }
  cwd?: string
  env_vars?: string[]
}

export interface McpServerConfig extends McpAuthorizationConfig {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  revision: number
  command?: string
  args?: string[]
  url?: string
  env: Record<string, string>
  headers: Record<string, string>
}
export interface McpConfigDocument {
  version: 1
  revision: number
  servers: McpServerConfig[]
}
export interface McpPublicConfig extends McpAuthorizationConfig {
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
}
export const MAX_CONFIG_BYTES = 256 * 1024

/** 校验对象边界，不接受数组、null 或可污染原型的字段。 */
export const configObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '配置字段必须是 JSON 对象。',
    )
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).some((key) =>
      ['__proto__', 'constructor', 'prototype'].includes(key),
    )
  )
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '配置包含不允许的字段。')
  return record
}

/** 只回显非秘密配置，env 与 Headers 的值保持在服务端。 */
export const publicMcpConfig = (server: McpServerConfig): McpPublicConfig => ({
  ...(server.transport === MCP_TRANSPORT.HTTP
    ? { url: server.url }
    : { command: server.command, args: server.args ?? [] }),
  ...authorizationConfig(server, true),
  enabled: server.enabled,
})

const stringField = (value: unknown, label: string, maximum = 4096): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    // oxlint-disable-next-line eslint/no-control-regex -- 信任边界必须拒绝控制字符。
    /[\u0000-\u001f]/u.test(value)
  )
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      `${label} 必须为有效的非空字符串。`,
    )
  return value
}

/** 保留标准 MCP 授权声明；客户端秘密永不进入公开配置。 */
export const authorizationConfig = (
  value: McpAuthorizationConfig,
  redact = false,
): McpAuthorizationConfig => ({
  ...(value.scopes ? { scopes: value.scopes } : {}),
  ...(value.oauth_resource ? { oauth_resource: value.oauth_resource } : {}),
  ...(value.bearer_token_env_var
    ? { bearer_token_env_var: value.bearer_token_env_var }
    : {}),
  ...(value.oauth
    ? {
        oauth: {
          ...value.oauth,
          ...(redact ? { client_secret: undefined } : {}),
        },
      }
    : {}),
  ...(value.cwd ? { cwd: value.cwd } : {}),
  ...(value.env_vars ? { env_vars: value.env_vars } : {}),
})

/** 验证 URL 和列表，不执行清单声明的变量或脚本。 */
const parseAuthorizationConfig = (
  value: Record<string, unknown>,
): McpAuthorizationConfig => {
  for (const field of ['scopes', 'env_vars'] as const) {
    if (
      value[field] !== undefined &&
      (!Array.isArray(value[field]) ||
        value[field].length > 100 ||
        value[field].some(
          (item: unknown) =>
            typeof item !== 'string' ||
            !item ||
            item.length > 2048 ||
            /[\s\0]/u.test(item),
        ))
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        `${field} 必须是有效字符串列表。`,
      )
  }
  if (
    value.env_vars &&
    (value.env_vars as string[]).some(
      (key) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key),
    )
  )
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '环境变量名称无效。')
  if (value.cwd !== undefined) stringField(value.cwd, 'cwd')
  if (
    value.bearer_token_env_var !== undefined &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(
      stringField(value.bearer_token_env_var, 'bearer_token_env_var'),
    )
  )
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '令牌变量名称无效。')
  if (value.oauth_resource !== undefined) {
    const resource = stringField(value.oauth_resource, 'oauth_resource')
    if (!URL.canParse(resource))
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, 'OAuth 资源地址无效。')
    const url = new URL(resource)
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, 'OAuth 资源地址无效。')
  }
  if (value.oauth !== undefined) {
    const oauth = configObject(value.oauth)
    if (
      Object.keys(oauth).some(
        (key) => !['client_id', 'client_secret', 'callback_port'].includes(key),
      )
    )
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, 'OAuth 配置字段无效。')
    for (const key of ['client_id', 'client_secret'])
      if (oauth[key] !== undefined) stringField(oauth[key], key)
    if (
      oauth.callback_port !== undefined &&
      (!Number.isInteger(oauth.callback_port) ||
        Number(oauth.callback_port) < 1 ||
        Number(oauth.callback_port) > 65535)
    )
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, 'OAuth 回调端口无效。')
  }
  return authorizationConfig(value as McpAuthorizationConfig)
}

/** 合并写入型凭据；省略保留、null 删除，并规范化 HTTP Header 键。 */
const mergeSecrets = (
  value: unknown,
  previous: Record<string, string>,
  headers = false,
) => {
  const result = { ...previous }
  if (value === undefined) return result
  const source = configObject(value)
  if (Object.keys(source).length > 100)
    throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, '凭据字段过多。')
  const keys = new Set<string>()
  for (const [rawKey, secret] of Object.entries(source)) {
    const key = headers ? rawKey.toLowerCase() : rawKey
    if (keys.has(key))
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        'Header 名称不能重复（不区分大小写）。',
      )
    keys.add(key)
    if (
      !(
        headers ? /^[!#$%&'*+.^_`|~0-9a-z-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/
      ).test(key) ||
      key.length > 200
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        '环境变量或 Header 名称无效。',
      )
    if (
      headers &&
      [
        'host',
        'origin',
        'content-length',
        'connection',
        'mcp-session-id',
        'mcp-protocol-version',
      ].includes(key)
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        '不能覆盖传输协议使用的 Header。',
      )
    if (secret === null) delete result[key]
    else {
      if (
        typeof secret !== 'string' ||
        secret.length > 16384 ||
        // oxlint-disable-next-line eslint/no-control-regex -- 防止进程环境与 Header 注入。
        /[\u0000\r\n]/u.test(secret)
      )
        throw new McpError(
          MCP_ERROR_CODE.INVALID_CONFIG,
          '凭据值必须是无换行的字符串，或用 null 清除。',
        )
      if (/\$\{input:[^}]+\}/u.test(secret))
        throw new McpError(
          MCP_ERROR_CODE.INVALID_CONFIG,
          '不支持 VS Code 的 ${input:...} 占位符，请在访问令牌或 headers/env 中填写实际值。',
        )
      result[key] = secret
    }
  }
  return result
}

/** 将外部表单/JSON 配置转成单一领域契约，目标变化时拒绝隐式迁移密钥。 */
export const parseMcpServer = (
  name: string,
  value: unknown,
  previous?: McpServerConfig,
): McpServerConfig => {
  stringField(name, '服务名称', 80)
  if (name !== name.trim())
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '服务名称不能包含首尾空格。',
    )
  const config = configObject(value)
  const isHttp = Object.hasOwn(config, 'url')
  if (isHttp === Object.hasOwn(config, 'command'))
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      `${name}：url 和 command 必须且只能填写一个。`,
    )
  const transport = isHttp ? MCP_TRANSPORT.HTTP : MCP_TRANSPORT.STDIO
  const fields = isHttp
    ? [
        'url',
        'headers',
        'enabled',
        'type',
        'oauth',
        'scopes',
        'oauth_resource',
        'bearer_token_env_var',
      ]
    : ['command', 'args', 'env', 'enabled', 'type', 'cwd', 'env_vars']
  if (
    Object.keys(config).some((key) => !fields.includes(key)) ||
    (config.type !== undefined && config.type !== transport)
  )
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      `${name}：包含不支持的配置字段或传输类型。`,
    )
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean')
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      `${name}.enabled 必须是布尔值。`,
    )
  let url: string | undefined,
    command: string | undefined,
    args: string[] | undefined
  if (isHttp) {
    url = stringField(config.url, `${name}.url`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new McpError(MCP_ERROR_CODE.INVALID_CONFIG, `${name}.url 无效。`)
    }
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        '服务地址仅支持 HTTP/HTTPS；凭据请放在 Headers，不能放入 URL。',
      )
    if (
      parsed.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        '远程服务必须使用 HTTPS；HTTP 仅用于本机回环地址。',
      )
    url = parsed.href
  } else {
    command = stringField(config.command, `${name}.command`)
    if (
      config.args !== undefined &&
      (!Array.isArray(config.args) ||
        config.args.length > 100 ||
        config.args.some(
          (arg) =>
            typeof arg !== 'string' || arg.length > 16384 || arg.includes('\0'),
        ))
    )
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        `${name}.args 必须为不超过 100 项的字符串数组。`,
      )
    args = (config.args as string[] | undefined) ?? []
  }
  const authorization = parseAuthorizationConfig(config)
  const sameTarget =
    previous?.transport === transport &&
    previous.url === url &&
    previous.command === command &&
    previous.cwd === authorization.cwd &&
    JSON.stringify(previous.args) === JSON.stringify(args)
  if (
    sameTarget &&
    authorization.oauth &&
    authorization.oauth.client_secret === undefined &&
    previous?.oauth?.client_secret
  )
    authorization.oauth.client_secret = previous.oauth.client_secret
  const oldSecrets = previous ? (isHttp ? previous.headers : previous.env) : {}
  const incoming = isHttp ? config.headers : config.env
  if (
    previous &&
    !sameTarget &&
    Object.keys(oldSecrets).length &&
    incoming === undefined
  )
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '连接目标已变化，请重新填写凭据或显式提供空的 env/headers。',
    )
  return {
    ...authorization,
    id: previous?.id ?? randomUUID(),
    name,
    transport,
    enabled:
      (config.enabled as boolean | undefined) ?? previous?.enabled ?? false,
    revision: previous?.revision ?? 1,
    ...(isHttp ? { url } : { command, args }),
    env: isHttp
      ? {}
      : mergeSecrets(config.env, sameTarget ? previous!.env : {}),
    headers: isHttp
      ? mergeSecrets(config.headers, sameTarget ? previous!.headers : {}, true)
      : {},
  }
}

/** 解析严格 JSON 并拒绝重复键；错误仅返回位置，不泄露输入片段。 */
export const parseMcpJson = (source: string): unknown => {
  if (Buffer.byteLength(source) > MAX_CONFIG_BYTES)
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      'JSON 配置不能超过 256 KiB。',
    )
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    const position = /position (\d+)/u.exec(
      error instanceof Error ? error.message : '',
    )?.[1]
    const prefix = source.slice(0, position ? Number(position) : source.length)
    const lines = prefix.split('\n')
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      `JSON 语法错误，位于第 ${lines.length} 行、第 ${(lines.at(-1)?.length ?? 0) + 1} 列附近。`,
    )
  }
  const stack: ({ keys: Set<string>; expectKey: boolean } | null)[] = []
  for (const token of source.match(
    /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/gu,
  ) ?? []) {
    if (token === '{') stack.push({ keys: new Set(), expectKey: true })
    else if (token === '[') stack.push(null)
    else if (token === '}' || token === ']') stack.pop()
    else if (token === ',') {
      const top = stack.at(-1)
      if (top) top.expectKey = true
    } else if (token.startsWith('"')) {
      const top = stack.at(-1)
      if (top?.expectKey) {
        const key = JSON.parse(token) as string
        if (top.keys.has(key))
          throw new McpError(
            MCP_ERROR_CODE.INVALID_CONFIG,
            'JSON 包含重复字段，请删除重复的配置键。',
          )
        top.keys.add(key)
        top.expectKey = false
      }
    }
  }
  return parsed
}

/** 收集需要脱敏的凭据，同时识别 Bearer/Basic 头中的原始凭据部分。 */
export const knownSecrets = (config: McpServerConfig) =>
  [
    ...Object.values(config.env),
    ...Object.values(config.headers),
    config.oauth?.client_secret ?? '',
  ]
    .flatMap((secret) => [
      secret,
      ...(/^(?:Bearer|Basic) (.+)$/iu.exec(secret)?.slice(1) ?? []),
    ])
    .filter(Boolean)

export interface McpFieldChange {
  path: string
  kind: (typeof MCP_CHANGE_KIND)[keyof typeof MCP_CHANGE_KIND]
  sensitive: boolean
  before?: string
  after?: string
}

/** 比较有效配置字段；凭据只报告键与变化类型，普通字段也按已知密钥脱敏。 */
const changedMcpFields = (
  previous?: McpServerConfig,
  next?: McpServerConfig,
): McpFieldChange[] => {
  const changes: McpFieldChange[] = []
  const secrets = [previous, next].flatMap((server) =>
    server ? knownSecrets(server) : [],
  )
  const compare = (
    path: string,
    before: unknown,
    after: unknown,
    sensitive = false,
  ) => {
    if (isDeepStrictEqual(before, after)) return
    changes.push({
      path,
      kind:
        before === undefined
          ? MCP_CHANGE_KIND.ADD
          : after === undefined
            ? MCP_CHANGE_KIND.DELETE
            : MCP_CHANGE_KIND.UPDATE,
      sensitive,
      ...(!sensitive && before !== undefined
        ? { before: JSON.stringify(redactMcpValue(before, secrets)) }
        : {}),
      ...(!sensitive && after !== undefined
        ? { after: JSON.stringify(redactMcpValue(after, secrets)) }
        : {}),
    })
  }
  compare('type', previous?.transport, next?.transport)
  for (const field of [
    'url',
    'command',
    'args',
    'enabled',
    'cwd',
    'env_vars',
    'scopes',
    'oauth_resource',
    'bearer_token_env_var',
  ] as const)
    compare(field, previous?.[field], next?.[field])
  compare('oauth', previous?.oauth, next?.oauth, true)
  for (const field of ['headers', 'env'] as const) {
    const before = previous?.[field] ?? {},
      after = next?.[field] ?? {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      compare(`${field}.${key}`, before[key], after[key], true)
  }
  return changes
}

/** 对完整 JSON 建立原子变更计划；名称变更明确表现为删除与新增。 */
export const planMcpConfig = (document: McpConfigDocument, value: unknown) => {
  const input = configObject(value)
  if (Object.hasOwn(input, 'servers') || Object.hasOwn(input, 'inputs'))
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '这是 VS Code 配置格式。本应用使用 mcpServers，不解析 inputs；请将 servers 改为 mcpServers，并在服务的访问令牌或 headers 中填写凭据。',
    )
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'mcpServers'))
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '根对象必须且只能包含 mcpServers。',
    )
  const records = configObject(input.mcpServers)
  if (Object.keys(records).length > 100)
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '最多配置 100 个 MCP 服务。',
    )
  const changes: {
    id: string
    name: string
    kind: (typeof MCP_CHANGE_KIND)[keyof typeof MCP_CHANGE_KIND]
    fields: McpFieldChange[]
  }[] = []
  const servers = Object.entries(records).map(([name, config]) => {
    const previous = document.servers.find((server) => server.name === name)
    const server = parseMcpServer(name, config, previous)
    const fields = changedMcpFields(previous, server)
    if (!previous)
      changes.push({ id: server.id, name, kind: MCP_CHANGE_KIND.ADD, fields })
    else if (fields.length) {
      server.revision += 1
      changes.push({
        id: server.id,
        name,
        kind: MCP_CHANGE_KIND.UPDATE,
        fields,
      })
    }
    return server
  })
  for (const server of document.servers)
    if (!servers.some((next) => next.id === server.id))
      changes.push({
        id: server.id,
        name: server.name,
        kind: MCP_CHANGE_KIND.DELETE,
        fields: changedMcpFields(server),
      })
  return { servers, changes }
}

/** 对 MCP 不可信结果按键和已知秘密值脱敏，禁止秘密进入日志与会话。 */
export const redactMcpValue = <T>(
  value: T,
  secrets: readonly string[],
  maskKeys = true,
): T => {
  const redact = (entry: unknown): unknown => {
    if (typeof entry === 'string')
      return secrets
        .filter(Boolean)
        .reduce((text, secret) => text.split(secret).join('[redacted]'), entry)
    if (Array.isArray(entry)) return entry.map(redact)
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry).map(([key, item]) => [
          key,
          maskKeys &&
          /token|password|secret|authorization|api.?key|cookie/iu.test(key)
            ? '[redacted]'
            : redact(item),
        ]),
      )
    return entry
  }
  return redact(value) as T
}
