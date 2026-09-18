import {
  PLUGIN_ERROR_CODE,
  PLUGIN_FORMAT,
  PLUGIN_INPUT_TARGET,
  type PluginFormat,
  type PluginInputTarget,
} from '@oh-my-harness/shared'
import {
  parseMcpServer,
  parseMcpJson,
  type McpServerConfig,
  type McpAuthorizationConfig,
} from '@oh-my-harness/agent-tools'
import { loadSkills } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { PluginError } from '../error.ts'
import { exists, relativePath, resolveContentPath } from '../source/files.ts'
import { validSkill } from '../source/skills.ts'

/** MCP 键保留上游大小写和下划线，身份由固定 serverId 管理。 */
export const mcpServerKey = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)
  )
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'MCP 服务名称无效。')
  return value
}

export interface PluginInput {
  key: string
  label: string
  description: string
  required: boolean
  secret: boolean
  server: string
  target: PluginInputTarget
  name: string
  prefix: string
}
export interface PluginMcpDefinition extends McpAuthorizationConfig {
  env?: Record<string, string>
  headers?: Record<string, string>
  url?: string
  command?: string
  args?: string[]
}
export interface PluginManifest {
  schemaVersion: 1
  format: PluginFormat
  name: string
  version: string
  displayName: string
  description: string
  author: string
  license: string
  examples: string[]
  requirements: string
  skills: string[]
  mcpServers: Record<string, PluginMcpDefinition>
  inputs: PluginInput[]
  hooks: PluginHook[]
  unavailable: string[]
}
export interface PluginHook {
  event: 'SessionStart' | 'UserPromptSubmit'
  matcher: string
  command: string
  timeout: number
}
export interface PluginSkill {
  name: string
  description: string
  path: string
}

/** 只接受明确字段，避免原型污染和未支持能力被静默忽略。 */
export const objectFields = (value: unknown, fields?: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件数据必须为 JSON 对象。',
    )
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).some(
      (key) =>
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        (fields && !fields.includes(key)),
    )
  )
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '包含不支持的字段或组件。')
  return record
}

/** 限定元数据长度并拒绝控制字符，不回显无效输入。 */
export const textField = (value: unknown, max = 1024): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /\p{Cc}/u.test(value)
  )
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件字段为空、过长或包含非法字符。',
    )
  return value
}

/** 外部清单的展示说明可多行；收敛为安全短摘要后再写入本项目清单。 */
export const externalDescription = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return (
    value
      .replace(/[\p{Cc}\s]+/gu, ' ')
      .trim()
      .slice(0, 1024) || undefined
  )
}
/** 市场和插件清单共用版本语法，预览与安装不得采用不同标准。 */
export const versionField = (value: unknown) => {
  const version = textField(value, 80)
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/u.test(
      version,
    )
  )
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件版本必须为明确的语义版本号。',
    )
  return version
}
export const nameField = (value: unknown) => {
  const name = textField(value, 64)
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(name))
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '名称只能使用小写字母、数字和连字符。',
    )
  return name
}
const stringList = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max)
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件列表字段无效或超过数量限制。',
    )
  return value.map((item) => textField(item))
}

/** 解析项目原生插件清单；凭据只能通过声明的输入绑定到 env/headers。 */
export const parseManifest = (value: unknown): PluginManifest => {
  const record = objectFields(value, [
    'schemaVersion',
    'format',
    'name',
    'version',
    'displayName',
    'description',
    'author',
    'license',
    'examples',
    'requirements',
    'skills',
    'mcpServers',
    'inputs',
    'hooks',
    'unavailable',
  ])
  if (record.schemaVersion !== 1)
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '不支持的插件清单版本。')
  const version = versionField(record.version)
  const format = record.format ?? PLUGIN_FORMAT.NATIVE
  if (!Object.values(PLUGIN_FORMAT).includes(format as PluginFormat))
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件格式无效。')
  const skills = stringList(record.skills ?? [], 100)
  if (new Set(skills).size !== skills.length)
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Skill 入口不能重复。')
  const servers = objectFields(record.mcpServers ?? {})
  if (Object.keys(servers).length > 20)
    throw new PluginError(
      PLUGIN_ERROR_CODE.LIMIT,
      '每个插件最多包含 20 个 MCP 服务。',
    )
  const mcpServers: Record<string, PluginMcpDefinition> = {}
  for (const [key, value] of Object.entries(servers)) {
    mcpServerKey(key)
    const definition = objectFields(value, [
      'url',
      'command',
      'args',
      'cwd',
      'env_vars',
      'env',
      'headers',
      'oauth',
      'scopes',
      'oauth_resource',
      'bearer_token_env_var',
    ])
    try {
      parseMcpServer(key, definition)
    } catch {
      throw new PluginError(
        PLUGIN_ERROR_CODE.INVALID,
        '插件 MCP 定义无效，请检查地址、命令和参数。',
      )
    }
    if (definition.cwd !== undefined) packagePath(String(definition.cwd))
    mcpServers[key] = definition as PluginMcpDefinition
  }
  const hookValues = record.hooks ?? []
  if (!Array.isArray(hookValues) || hookValues.length > 30)
    throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, '插件 Hooks 数量无效。')
  const hooks: PluginHook[] = hookValues.map((value) => {
    const hook = objectFields(value, ['event', 'matcher', 'command', 'timeout'])
    if (
      (hook.event !== 'SessionStart' && hook.event !== 'UserPromptSubmit') ||
      typeof hook.timeout !== 'number' ||
      !Number.isInteger(hook.timeout) ||
      hook.timeout < 1 ||
      hook.timeout > 30
    )
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Hook 事件或超时无效。')
    return {
      event: hook.event,
      matcher:
        hook.matcher === undefined || hook.matcher === ''
          ? ''
          : textField(hook.matcher, 200),
      command: textField(hook.command, 2000),
      timeout: hook.timeout,
    }
  })
  if (
    !skills.length &&
    !Object.keys(servers).length &&
    !hooks.length &&
    !stringList(record.unavailable ?? [], 30).length
  )
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件至少需要包含一个 Skill 或 MCP 服务。',
    )
  if (
    !Array.isArray(record.inputs ?? []) ||
    ((record.inputs ?? []) as unknown[]).length > 100
  )
    throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, '插件配置项无效或过多。')
  const keys = new Set<string>(),
    bindings = new Set<string>()
  const inputs = ((record.inputs ?? []) as unknown[]).map(
    (value): PluginInput => {
      const input = objectFields(value, [
        'key',
        'label',
        'description',
        'required',
        'secret',
        'server',
        'target',
        'name',
        'prefix',
      ])
      const key = nameField(input.key),
        server = mcpServerKey(input.server)
      const definition = mcpServers[server]
      const target = input.target
      if (
        !definition ||
        (target !== PLUGIN_INPUT_TARGET.ENV &&
          target !== PLUGIN_INPUT_TARGET.HEADERS) ||
        (target === PLUGIN_INPUT_TARGET.HEADERS) !== !!definition.url ||
        typeof input.required !== 'boolean' ||
        typeof input.secret !== 'boolean'
      )
        throw new PluginError(
          PLUGIN_ERROR_CODE.INVALID,
          '插件输入必须绑定到对应 MCP 的 env 或 headers。',
        )
      const name = textField(input.name, 200)
      const binding = `${server}:${target}:${target === PLUGIN_INPUT_TARGET.HEADERS ? name.toLowerCase() : name}`
      if (keys.has(key) || bindings.has(binding))
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '配置字段或目标重复。')
      keys.add(key)
      bindings.add(binding)
      try {
        parseMcpServer(server, {
          ...definition,
          [target]: { [name]: 'validation' },
        })
      } catch {
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '配置字段绑定无效。')
      }
      if (
        !input.secret &&
        /token|password|secret|authorization|api.?key|cookie/iu.test(name)
      )
        throw new PluginError(
          PLUGIN_ERROR_CODE.INVALID,
          '凭据字段必须标记为敏感输入。',
        )
      return {
        key,
        server,
        target,
        name,
        required: input.required,
        secret: input.secret,
        label: textField(input.label, 100),
        description:
          input.description === undefined || input.description === ''
            ? ''
            : textField(input.description),
        prefix:
          input.prefix === undefined || input.prefix === ''
            ? ''
            : textField(input.prefix, 100),
      }
    },
  )
  return {
    schemaVersion: 1,
    format: format as PluginFormat,
    name: nameField(record.name),
    version,
    displayName: textField(record.displayName, 80),
    description: textField(record.description),
    author: textField(record.author, 100),
    license: textField(record.license, 100),
    examples: stringList(record.examples ?? [], 10),
    requirements:
      record.requirements === undefined || record.requirements === ''
        ? ''
        : textField(record.requirements),
    skills,
    mcpServers,
    inputs,
    hooks,
    unavailable: stringList(record.unavailable ?? [], 30),
  }
}

const packagePath = (value: string) => {
  const path = posix.normalize(relativePath(value))
  if (path === '..' || path.startsWith('../'))
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件组件路径不能越界。')
  return path
}
const optionalJson = async (root: string, path: string) => {
  const normalized = packagePath(path)
  if (!(await exists(join(root, normalized)))) return undefined
  const actual = await resolveContentPath(root, normalized)
  if ((await stat(actual)).size > 256 * 1024)
    throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, '插件组件清单过大。')
  try {
    return objectFields(parseMcpJson(await readFile(actual, 'utf8')))
  } catch (error) {
    if (error instanceof PluginError) throw error
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件组件 JSON 无法解析。')
  }
}
const paths = (value: unknown): string[] =>
  value === undefined
    ? []
    : typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.map((item) => textField(item, 500))
        : (() => {
            throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '组件路径无效。')
          })()

const externalFiles = async (root: string, format: PluginFormat) => {
  const portable = await optionalJson(root, 'plugin.json')
  const codex = await optionalJson(root, '.codex-plugin/plugin.json')
  const claude = await optionalJson(root, '.claude-plugin/plugin.json')
  const recognizedPortable =
    typeof portable?.$schema === 'string' &&
    portable.$schema.startsWith('https://agent-plugins.org/schemas/')
  const overlay =
    format === PLUGIN_FORMAT.CLAUDE_CODE ? (claude ?? codex) : (codex ?? claude)
  if (!portable && !overlay)
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '缺少 Codex 或 Claude Code 插件清单。',
    )
  return { portable, overlay, recognizedPortable }
}

/** 只读同仓库外部插件元数据；目录列表不加载 Skill 或执行脚本。 */
export const externalMetadata = async (root: string, format: PluginFormat) => {
  const { portable, overlay, recognizedPortable } = await externalFiles(
    root,
    format,
  )
  const record =
    format === PLUGIN_FORMAT.CLAUDE_CODE && overlay
      ? overlay
      : recognizedPortable
        ? portable!
        : (overlay ?? portable!)
  const extension = objectFields(
    recognizedPortable && portable?.extensions
      ? (objectFields(portable.extensions)['com.openai'] ?? {})
      : {},
  )
  const presentation = objectFields(
    extension.interface ?? overlay?.interface ?? {},
  )
  const author =
    record.author && typeof record.author === 'object'
      ? objectFields(record.author).name
      : record.author
  return {
    name: nameField(record.name ?? portable?.name),
    version:
      record.version === undefined ? undefined : versionField(record.version),
    displayName: presentation.displayName ?? record.displayName ?? record.name,
    description:
      externalDescription(presentation.shortDescription) ??
      externalDescription(record.description) ??
      externalDescription(portable?.description),
    logoPath: presentation.logo ?? presentation.composerIcon,
    logoDarkPath: presentation.logoDark,
    composerIconPath: presentation.composerIcon,
    composerIconDarkPath: presentation.composerIconDark,
    author: typeof author === 'string' ? author : '未提供',
    license: record.license ?? portable?.license ?? '未提供',
    record,
    extension,
    recognizedPortable,
  }
}

const skillEntries = async (root: string, entries: string[]) => {
  const found = new Set<string>()
  for (const raw of entries) {
    const path = packagePath(raw)
    if (!(await exists(join(root, path))))
      throw new PluginError(
        PLUGIN_ERROR_CODE.INVALID,
        '声明的 Skill 目录不存在。',
      )
    const directory = await resolveContentPath(root, path)
    if ((await stat(directory)).isFile())
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Skill 入口必须是目录。')
    if (await exists(join(directory, 'SKILL.md'))) {
      found.add(path)
      continue
    }
    const children = await readdir(directory, { withFileTypes: true })
    if (children.length > 100)
      throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, 'Skill 数量过多。')
    for (const child of children)
      if (
        child.isDirectory() &&
        (await exists(join(directory, child.name, 'SKILL.md')))
      )
        found.add(packagePath(posix.join(path, child.name)))
  }
  return [...found]
}

const externalServers = async (
  root: string,
  file: string,
  declared: unknown,
  unavailable: string[],
) => {
  const value =
    declared === undefined
      ? await optionalJson(root, file)
      : typeof declared === 'string'
        ? await optionalJson(root, declared)
        : declared
  if (value === undefined) return {}
  const record = objectFields(value)
  const definitions = objectFields(record.mcpServers ?? record)
  const servers: Record<string, PluginMcpDefinition> = {}
  for (const [name, raw] of Object.entries(definitions)) {
    mcpServerKey(name)
    const config = objectFields(raw)
    const fields = config.url
      ? [
          'url',
          'headers',
          'oauth',
          'scopes',
          'oauth_resource',
          'bearer_token_env_var',
        ]
      : ['command', 'args', 'env', 'env_vars', 'cwd']
    if (!config.url && !config.command) {
      unavailable.push(`MCP ${name}：传输类型暂不支持`)
      continue
    }
    const definition = Object.fromEntries(
      fields
        .filter((key) => config[key] !== undefined)
        .map((key) => [key, config[key]]),
    )
    parseMcpServer(name, definition)
    servers[name] = definition as PluginMcpDefinition
  }
  return servers
}

const externalHooks = async (
  root: string,
  declared: unknown,
  unavailable: string[],
) => {
  const values =
    declared === undefined
      ? ((await optionalJson(root, 'hooks/hooks.json')) ?? undefined)
      : declared
  const sources = Array.isArray(values)
    ? values
    : values === undefined
      ? []
      : [values]
  const hooks: PluginHook[] = []
  for (const source of sources) {
    const config =
      typeof source === 'string' ? await optionalJson(root, source) : source
    if (!config)
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Hook 清单不存在。')
    const events = objectFields(objectFields(config).hooks ?? config)
    for (const [event, groups] of Object.entries(events)) {
      if (event !== 'SessionStart' && event !== 'UserPromptSubmit') {
        unavailable.push(`Hook ${event}：当前 Runtime 无对应事件`)
        continue
      }
      if (!Array.isArray(groups) || groups.length > 30)
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Hook 事件组无效。')
      for (const group of groups) {
        const definition = objectFields(group)
        if (!Array.isArray(definition.hooks) || definition.hooks.length > 30)
          throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Hook 命令组无效。')
        const matcher =
          definition.matcher === undefined
            ? ''
            : textField(definition.matcher, 200)
        for (const raw of definition.hooks) {
          const handler = objectFields(raw)
          if (handler.type !== 'command') {
            unavailable.push(`Hook ${event}：仅支持命令处理器`)
            continue
          }
          hooks.push({
            event,
            matcher,
            command: textField(handler.command, 2000),
            timeout:
              handler.timeout === undefined ? 5 : Number(handler.timeout),
          })
        }
      }
    }
  }
  return hooks
}

const externalManifest = async (
  root: string,
  format: PluginFormat,
  hash?: string,
  catalogVersion?: string,
) => {
  const meta = await externalMetadata(root, format)
  const record = meta.record,
    unavailable: string[] = []
  const defaultSkills = (await exists(join(root, 'skills'))) ? ['skills'] : []
  const skills = await skillEntries(
    root,
    meta.recognizedPortable && format !== PLUGIN_FORMAT.CLAUDE_CODE
      ? defaultSkills
      : [...defaultSkills, ...paths(record.skills)],
  )
  const mcpServers = await externalServers(
    root,
    meta.recognizedPortable && format !== PLUGIN_FORMAT.CLAUDE_CODE
      ? 'mcp.json'
      : '.mcp.json',
    meta.recognizedPortable && format !== PLUGIN_FORMAT.CLAUDE_CODE
      ? undefined
      : record.mcpServers,
    unavailable,
  )
  const hooks = await externalHooks(
    root,
    meta.recognizedPortable && format !== PLUGIN_FORMAT.CLAUDE_CODE
      ? meta.extension.hooks
      : record.hooks,
    unavailable,
  )
  for (const [field, path] of [
    ['Agents', 'agents'],
    ['Commands', 'commands'],
    ['LSP', '.lsp.json'],
    ['Monitors', 'monitors'],
  ] as const)
    if (
      record[field.toLowerCase()] !== undefined ||
      (await exists(join(root, path)))
    )
      unavailable.push(`${field}：当前 Runtime 暂不支持`)
  const appConfig = await optionalJson(root, '.app.json')
  if (appConfig?.apps)
    for (const [name, value] of Object.entries(objectFields(appConfig.apps))) {
      const app = objectFields(value)
      if (app.required === false || app.optional === true) continue
      if (Object.hasOwn(mcpServers, name)) continue
      if (
        Object.keys(objectFields(appConfig.apps)).length === 1 &&
        Object.values(mcpServers).some((server) => server.url)
      )
        continue
      unavailable.push(
        `App ${name}：需要平台连接器授权，当前插件未提供可替代的公开 MCP 连接入口`,
      )
    }
  const version =
    meta.version ??
    (catalogVersion === undefined ? undefined : versionField(catalogVersion)) ??
    (hash ? `0.0.0+sha.${hash.slice(0, 12)}` : undefined)
  if (!version)
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件版本无法确定。')
  return parseManifest({
    schemaVersion: 1,
    format,
    name: meta.name,
    version,
    displayName: textField(meta.displayName, 80),
    description: textField(meta.description ?? `来自 ${format} 的插件`),
    author: textField(meta.author, 100),
    license: textField(meta.license, 100),
    examples: [],
    skills,
    mcpServers,
    inputs: [],
    hooks,
    unavailable: [...new Set(unavailable)],
  })
}

/** 从完整包读取原生或外部清单，并验证所有可运行 Skill。 */
export const inspectManifest = async (
  root: string,
  preferredFormat?: PluginFormat,
  hash?: string,
  catalogVersion?: string,
) => {
  const rootFile = await optionalJson(root, 'plugin.json')
  let manifest: PluginManifest
  if (rootFile?.schemaVersion === 1) {
    manifest = parseManifest(rootFile)
    if (manifest.format !== PLUGIN_FORMAT.NATIVE)
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '原生清单格式无效。')
  } else {
    const format =
      preferredFormat ??
      ((await exists(join(root, '.codex-plugin/plugin.json'))) ||
      (typeof rootFile?.$schema === 'string' &&
        rootFile.$schema.startsWith('https://agent-plugins.org/schemas/'))
        ? PLUGIN_FORMAT.CODEX
        : PLUGIN_FORMAT.CLAUDE_CODE)
    manifest = await externalManifest(root, format, hash, catalogVersion)
  }
  const skills: PluginSkill[] = [],
    names = new Set<string>()
  const env = new NodeExecutionEnv({ cwd: root })
  try {
    for (const entry of manifest.skills) {
      const directory = await resolveContentPath(root, entry)
      const loaded = await loadSkills(env, directory)
      const skill = loaded.skills.find(
        (item) => item.filePath === join(directory, 'SKILL.md'),
      )
      if (!skill || !validSkill(skill) || names.has(skill.name))
        throw new PluginError(
          PLUGIN_ERROR_CODE.INVALID,
          '插件 Skill 缺失、无效或名称重复。',
        )
      names.add(skill.name)
      skills.push({
        name: skill.name,
        description: skill.description,
        path: entry,
      })
    }
  } finally {
    await env.cleanup()
  }
  return { manifest, skills }
}

/** 将用户配置绑定到服务端验证的目标，不解析脚本或任意变量。 */
export const configuredServers = (
  manifest: PluginManifest,
  values: Record<string, string>,
  enabled: boolean,
) =>
  Object.fromEntries(
    Object.entries(manifest.mcpServers).map(([key, definition]) => {
      const config: Record<string, unknown> = {
        ...definition,
        enabled,
        env: { ...definition.env },
        headers: { ...definition.headers },
      }
      for (const input of manifest.inputs.filter(
        (input) => input.server === key,
      ))
        if (values[input.key] !== undefined)
          (config[input.target] as Record<string, string>)[input.name] =
            input.prefix + values[input.key]
      if (definition.url) delete config.env
      else delete config.headers
      return [key, parseMcpServer(key, config)]
    }),
  ) as Record<string, McpServerConfig>
