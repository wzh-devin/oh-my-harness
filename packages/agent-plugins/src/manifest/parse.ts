import { readdir, realpath } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import {
  MCP_TRANSPORT,
  PLUGIN_COMPATIBILITY_STATUS,
  PLUGIN_IMPORT_KIND,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_SOURCE_TYPE,
} from '@oh-my-harness/shared'
import {
  exists,
  object,
  readJson,
  resolveContentPath,
} from '../source/files.ts'
import { normalizeGitSource } from '../source/fetch.ts'
import {
  PluginError,
  type CatalogEntry,
  type ImportCandidate,
  type ManifestFormat,
  type MarketplaceDescriptor,
  type McpServerDefinition,
  type PluginDescriptor,
} from './types.ts'

const entries: [string, ManifestFormat, ImportCandidate['kind']][] = [
  [
    'marketplace.json',
    PLUGIN_MANIFEST_FORMAT.NATIVE,
    PLUGIN_IMPORT_KIND.MARKETPLACE,
  ],
  [
    '.agents/plugins/marketplace.json',
    PLUGIN_MANIFEST_FORMAT.CODEX,
    PLUGIN_IMPORT_KIND.MARKETPLACE,
  ],
  [
    '.claude-plugin/marketplace.json',
    PLUGIN_MANIFEST_FORMAT.CLAUDE,
    PLUGIN_IMPORT_KIND.MARKETPLACE,
  ],
  ['plugin.json', PLUGIN_MANIFEST_FORMAT.NATIVE, PLUGIN_IMPORT_KIND.PLUGIN],
  [
    '.codex-plugin/plugin.json',
    PLUGIN_MANIFEST_FORMAT.CODEX,
    PLUGIN_IMPORT_KIND.PLUGIN,
  ],
  [
    '.claude-plugin/plugin.json',
    PLUGIN_MANIFEST_FORMAT.CLAUDE,
    PLUGIN_IMPORT_KIND.PLUGIN,
  ],
]

/** 校验清单文本长度和控制字符。 */
export function textField(value: unknown, fallback = '', max = 2048) {
  if (value === undefined) return fallback
  if (
    typeof value !== 'string' ||
    value.length > max ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char),
    )
  )
    throw new PluginError('PLUGIN_MANIFEST_INVALID', '清单文本字段无效')
  return value
}

function nameField(value: unknown) {
  const name = textField(value, '', 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new PluginError(
      'PLUGIN_NAME_INVALID',
      '名称必须为小写 kebab-case，最多 64 字符',
    )
  return name
}

function paths(value: unknown): string[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map((item) => textField(item))
}

/** 扫描支持的清单入口，保留歧义供用户选择。 */
export async function detectCandidates(
  root: string,
): Promise<ImportCandidate[]> {
  const found: ImportCandidate[] = []
  async function scan(directory: string, depth: number) {
    let manifests = 0
    for (const [file, format, kind] of entries) {
      if (await exists(join(directory, file))) {
        const path = relative(root, directory) || '.'
        found.push({
          key: `${path}:${format}:${kind}`,
          root: path,
          format,
          kind,
        })
        manifests++
      }
    }
    if (manifests || depth >= 3) return
    const children = await readdir(directory, { withFileTypes: true })
    if (
      (await exists(join(directory, 'skills'))) ||
      (await exists(join(directory, 'commands'))) ||
      (await exists(join(directory, '.mcp.json')))
    ) {
      const path = relative(root, directory) || '.'
      found.push({
        key: `${path}:claude:plugin`,
        root: path,
        format: PLUGIN_MANIFEST_FORMAT.CLAUDE,
        kind: PLUGIN_IMPORT_KIND.PLUGIN,
      })
      return
    }
    for (const child of children)
      if (child.isDirectory() && !child.name.startsWith('.'))
        await scan(join(directory, child.name), depth + 1)
  }
  await scan(root, 0)
  if (!found.length)
    throw new PluginError(
      'PLUGIN_ENTRY_NOT_FOUND',
      '未找到原生、Codex 或 Claude 插件/市场入口',
    )
  if (found.length > 100)
    throw new PluginError(
      'PLUGIN_TOO_MANY_ENTRIES',
      '入口过多，请指定仓库子目录',
    )
  return found
}

/** 将原生及外部市场清单归一化为目录条目。 */
export async function parseMarketplace(
  root: string,
  format: ManifestFormat,
  allowedHosts?: string[],
): Promise<MarketplaceDescriptor> {
  const entry = entries.find(
    (item) => item[1] === format && item[2] === PLUGIN_IMPORT_KIND.MARKETPLACE,
  )!
  const data = await readJson(root, entry[0])
  if (format === PLUGIN_MANIFEST_FORMAT.NATIVE && data.schemaVersion !== 1)
    throw new PluginError(
      'PLUGIN_SCHEMA_UNSUPPORTED',
      '不支持的市场 schemaVersion',
    )
  if (!Array.isArray(data.plugins) || data.plugins.length > 5000)
    throw new PluginError(
      'PLUGIN_MARKETPLACE_INVALID',
      'plugins 必须是最多 5000 个条目的数组',
    )
  const seen = new Set<string>()
  const catalog: CatalogEntry[] = data.plugins.map((raw) => {
    const item = object(raw)
    const name = nameField(item.name)
    if (seen.has(name))
      throw new PluginError('PLUGIN_ENTRY_DUPLICATE', '市场内插件名称重复')
    seen.add(name)
    const result: CatalogEntry = {
      id: name,
      name,
      description: textField(item.description),
      compatibility: [],
    }
    try {
      const source =
        typeof item.source === 'string'
          ? { type: PLUGIN_SOURCE_TYPE.PATH, path: item.source }
          : object(item.source)
      const type = source.type ?? source.source
      if (type === PLUGIN_SOURCE_TYPE.PATH || type === 'local')
        result.source = {
          type: PLUGIN_SOURCE_TYPE.PATH,
          path: textField(source.path),
        }
      else if (type === 'github')
        result.source = {
          ...normalizeGitSource(textField(source.repo), allowedHosts),
          ...(source.ref ? { ref: textField(source.ref) } : {}),
          ...(source.path ? { path: textField(source.path) } : {}),
        }
      else if (
        type === PLUGIN_SOURCE_TYPE.GIT ||
        type === 'url' ||
        type === 'git-subdir'
      )
        result.source = {
          ...normalizeGitSource(textField(source.url), allowedHosts),
          ...(source.ref ? { ref: textField(source.ref) } : {}),
          ...(source.path ? { path: textField(source.path) } : {}),
        }
      else
        throw new PluginError('PLUGIN_SOURCE_UNSUPPORTED', '此条目来源尚不支持')
      if (format === PLUGIN_MANIFEST_FORMAT.CLAUDE) result.definition = item
    } catch {
      result.compatibility.push({
        capability: 'source',
        status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
        message: '来源类型或地址不受支持，请直接导入兼容包',
      })
    }
    return result
  })
  for (const item of catalog)
    if (item.source?.type === PLUGIN_SOURCE_TYPE.PATH) {
      try {
        await resolveContentPath(root, item.source.path)
      } catch {
        item.source = undefined
        item.compatibility.push({
          capability: 'source',
          status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
          message: '条目路径不存在或越界',
        })
      }
    }
  const name = nameField(data.name)
  return {
    name,
    displayName: textField(data.displayName, name),
    format,
    entries: catalog,
  }
}

function stringMap(value: unknown) {
  return Object.fromEntries(
    Object.entries(object(value ?? {})).map(([key, value]) => {
      if (!/^[\w.-]{1,128}$/.test(key))
        throw new PluginError('PLUGIN_MCP_INVALID', 'MCP 配置键无效')
      return [key, textField(value, '', 8192)]
    }),
  )
}

/** 归一化插件能力声明并保留不支持功能的诊断。 */
export async function parsePlugin(
  root: string,
  format: ManifestFormat,
  definition?: Record<string, unknown>,
): Promise<PluginDescriptor> {
  root = await realpath(root)
  const entry = entries.find(
    (item) => item[1] === format && item[2] === PLUGIN_IMPORT_KIND.PLUGIN,
  )!
  const hasManifest = await exists(join(root, entry[0]))
  const manifest = hasManifest ? await readJson(root, entry[0]) : {}
  if (!hasManifest && format !== PLUGIN_MANIFEST_FORMAT.CLAUDE)
    throw new PluginError('PLUGIN_MANIFEST_MISSING', '缺少插件清单')
  if (format === PLUGIN_MANIFEST_FORMAT.NATIVE && manifest.schemaVersion !== 1)
    throw new PluginError(
      'PLUGIN_SCHEMA_UNSUPPORTED',
      '不支持的插件 schemaVersion',
    )
  const componentKeys = [
    'skills',
    'commands',
    'mcpServers',
    'hooks',
    'agents',
    'lspServers',
  ]
  if (
    definition?.strict === false &&
    componentKeys.some((key) => manifest[key] !== undefined)
  )
    throw new PluginError(
      'PLUGIN_MANIFEST_CONFLICT',
      'Claude strict:false 条目与插件清单组件冲突',
    )
  const data =
    definition?.strict === false ? definition : { ...definition, ...manifest }
  const name = nameField(data.name ?? basename(root))
  const result: PluginDescriptor = {
    name,
    description: textField(data.description),
    version:
      data.version === undefined ? undefined : textField(data.version, '', 128),
    format,
    skills: [],
    commands: [],
    servers: [],
    compatibility: [],
    blocked: false,
  }
  for (const capability of [
    'hooks',
    'agents',
    'lspServers',
    'apps',
    'dependencies',
    'main',
    'channels',
    'workflows',
    'outputStyles',
    'experimental',
  ]) {
    const defaultPath = {
      hooks: 'hooks/hooks.json',
      agents: 'agents',
      lspServers: '.lsp.json',
      apps: '.app.json',
    }[capability]
    if (
      data[capability] !== undefined ||
      (format !== PLUGIN_MANIFEST_FORMAT.NATIVE &&
        defaultPath &&
        (await exists(join(root, defaultPath))))
    ) {
      result.compatibility.push({
        capability,
        status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
        message: `${capability} 暂不支持`,
      })
      if (['dependencies', 'apps', 'main'].includes(capability))
        result.blocked = true
    }
  }
  for (const kind of ['skills', 'commands'] as const) {
    const declared = paths(data[kind])
    const supplemental =
      definition?.strict !== false && definition && hasManifest
        ? paths(definition[kind])
        : []
    const defaults =
      format === PLUGIN_MANIFEST_FORMAT.NATIVE
        ? []
        : kind === 'skills' || data[kind] === undefined
          ? [kind]
          : []
    // Claude root-source curation limits skills to explicitly named subdirectories.
    const defaultPaths: string[] =
      format === PLUGIN_MANIFEST_FORMAT.CLAUDE &&
      kind === 'skills' &&
      definition?.source === './' &&
      declared.length
        ? []
        : defaults
    for (const path of new Set([
      ...defaultPaths,
      ...declared,
      ...supplemental,
    ])) {
      if (defaultPaths.includes(path) && !(await exists(join(root, path))))
        continue
      try {
        const normalized =
          relative(root, await resolveContentPath(root, path)) || '.'
        if (!result[kind].includes(normalized)) result[kind].push(normalized)
      } catch {
        result.compatibility.push({
          capability: kind,
          status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
          message: '声明路径不存在或越界',
        })
      }
    }
    if (result[kind].length)
      result.compatibility.push({
        capability: kind,
        status: PLUGIN_COMPATIBILITY_STATUS.SUPPORTED,
        message:
          kind === 'skills'
            ? '支持技能和包内资源'
            : '支持普通提示词命令；动态命令会被过滤',
      })
  }
  const configs: unknown[] = []
  if (
    format !== PLUGIN_MANIFEST_FORMAT.NATIVE &&
    (await exists(join(root, '.mcp.json')))
  )
    configs.push('./.mcp.json')
  const declaredMcp =
    format === PLUGIN_MANIFEST_FORMAT.NATIVE ? data.mcp : data.mcpServers
  if (declaredMcp !== undefined)
    configs.push(...(Array.isArray(declaredMcp) ? declaredMcp : [declaredMcp]))
  if (
    definition?.strict !== false &&
    hasManifest &&
    definition?.mcpServers !== undefined
  )
    configs.push(definition.mcpServers)
  const servers = new Map<string, McpServerDefinition>()
  for (const config of configs) {
    try {
      const parsed =
        typeof config === 'string'
          ? await readJson(root, config)
          : object(config)
      const records = object(parsed.mcpServers ?? parsed)
      for (const [serverName, raw] of Object.entries(records)) {
        if (!/^[\w.-]{1,100}$/.test(serverName) || servers.size >= 50)
          throw new PluginError('PLUGIN_MCP_INVALID', 'MCP 服务名或数量无效')
        const server = object(raw)
        const transport =
          server.type ?? (server.url ? MCP_TRANSPORT.HTTP : MCP_TRANSPORT.STDIO)
        if (
          transport !== MCP_TRANSPORT.STDIO &&
          transport !== MCP_TRANSPORT.HTTP &&
          transport !== 'streamable-http'
        ) {
          result.compatibility.push({
            capability: `mcp:${serverName}`,
            status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
            message: '仅支持 stdio 和 Streamable HTTP',
          })
          continue
        }
        if (server.headersHelper || server.oauth || server.auth) {
          result.compatibility.push({
            capability: `mcp:${serverName}`,
            status: PLUGIN_COMPATIBILITY_STATUS.NEEDS_CONFIGURATION,
            message: '专有认证配置不自动执行，请配置标准认证',
          })
        }
        if (transport === MCP_TRANSPORT.STDIO) {
          const command = textField(server.command, '', 8192)
          if (!command)
            throw new PluginError('PLUGIN_MCP_INVALID', 'stdio 缺少 command')
          servers.set(serverName, {
            name: serverName,
            transport: MCP_TRANSPORT.STDIO,
            command,
            args: paths(server.args),
            env: stringMap(server.env),
          })
        } else {
          const url = textField(server.url, '', 8192)
          if (!url) throw new PluginError('PLUGIN_MCP_INVALID', 'HTTP 缺少 url')
          servers.set(serverName, {
            name: serverName,
            transport: MCP_TRANSPORT.HTTP,
            url,
            headers: stringMap(server.headers),
          })
        }
        result.compatibility.push({
          capability: `mcp:${serverName}`,
          status: PLUGIN_COMPATIBILITY_STATUS.NEEDS_CONFIGURATION,
          message: '安装后显式配置并允许连接；认证与工具审批独立',
        })
      }
    } catch {
      result.compatibility.push({
        capability: 'mcp',
        status: PLUGIN_COMPATIBILITY_STATUS.UNSUPPORTED,
        message: 'MCP 配置无效或路径越界',
      })
    }
  }
  result.servers = [...servers.values()]
  return result
}
