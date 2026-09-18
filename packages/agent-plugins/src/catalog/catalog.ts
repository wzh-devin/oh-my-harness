import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  MCP_AUTH_POLICY,
  type McpAuthPolicy,
  PLUGIN_ERROR_CODE,
  PLUGIN_FORMAT,
  PLUGIN_SOURCE_KIND,
  type PluginFormat,
  type PluginSourceKind,
} from '@oh-my-harness/shared'
import { PluginError } from '../error.ts'
import { iconMime, MAX_ICON_BYTES, readPluginIcon } from '../source/icons.ts'
import {
  objectFields,
  nameField,
  textField,
  versionField,
  externalMetadata,
  externalDescription,
} from '../manifest/manifest.ts'
import {
  exists,
  inspectTree,
  resolveContentPath,
  relativePath,
} from '../source/files.ts'
import { fetchGit, normalizeGitSource } from '../source/fetch.ts'
import {
  atomicJson,
  HASH_PATTERN,
  privateDirectory,
  readJson,
} from '../installation/store.ts'

export interface PluginCatalogEntry {
  authentication?: McpAuthPolicy
  id: string
  name: string
  displayName: string
  description: string
  category: string
  version?: string
  iconId?: string
  iconDarkId?: string
  format: PluginFormat
  market: string
  source: {
    kind: PluginSourceKind
    path: string
    url?: string
    commit?: string
    ref?: string
    hash?: string
    reason?: string
  }
}
export interface PluginMarket {
  id: string
  name: string
  builtIn: boolean
  format: PluginFormat
  url?: string
  ref?: string
  path?: string
  commit?: string
  updatedAt: string
}
interface CatalogDocument {
  schemaVersion: 2
  updatedAt: string
  markets: PluginMarket[]
  entries: PluginCatalogEntry[]
}
const identity = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const ICON_ID = /^[a-f0-9]{64}\.(png|jpg|webp)$/u
const MAX_ICON_CACHE_BYTES = 64 * MAX_ICON_BYTES
/** 所有清单路径先收敛为仓库内路径，拒绝越界和平台路径。 */
const catalogPath = (value: unknown) => {
  const path = posix.normalize(relativePath(textField(value, 500)))
  if (path === '..' || path.startsWith('../'))
    throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '目录路径不能超出仓库。')
  return path
}
const commitField = (value: unknown) => {
  const commit = textField(value, 40)
  if (!/^[a-f0-9]{40}$/u.test(commit))
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '插件来源必须固定到完整 commit。',
    )
  return commit
}

/** 保存用户市场与成功目录；市场变化不修改已安装插件或运行能力。 */
export class PluginCatalog {
  readonly root: string
  private readonly cache: string
  private readonly allowedHosts?: string[]
  private document?: CatalogDocument
  private ready?: Promise<void>
  private pending: Promise<unknown> = Promise.resolve()
  private readonly errors = new Map<string, string>()
  private readonly controller = new AbortController()
  constructor(root: string, cache: string, allowedHosts?: string[]) {
    this.root = root
    this.cache = cache
    this.allowedHosts = allowedHosts
  }
  private ensure() {
    this.ready ??= this.initialize()
    return this.ready
  }
  private iconDirectory() {
    return join(this.cache, 'icons')
  }
  private async iconCacheBytes() {
    const directory = this.iconDirectory()
    if (!(await exists(directory))) return 0
    await privateDirectory(directory)
    let total = 0
    for (const name of await readdir(directory)) {
      if (!ICON_ID.test(name)) continue
      const info = await lstat(join(directory, name))
      if (info.isFile() && !info.isSymbolicLink()) total += info.size
    }
    return total
  }
  /** 清单图片是可选展示资源；任何不可信路径或图片异常只触发通用图标回退。 */
  private async cacheIcon(
    pluginRoot: string,
    declared: unknown,
    budget: { used: number },
  ): Promise<string | undefined> {
    try {
      const image = await readPluginIcon(pluginRoot, declared)
      if (!image) return undefined
      const { bytes, ext } = image
      const id = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
      const directory = this.iconDirectory()
      await privateDirectory(directory)
      if (await exists(join(directory, id))) return id
      if (budget.used + bytes.length > MAX_ICON_CACHE_BYTES) return undefined
      const temporary = join(directory, `.${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporary, join(directory, id))
        budget.used += bytes.length
      } finally {
        await rm(temporary, { force: true })
      }
      return id
    } catch {
      return undefined
    }
  }
  private async cleanIcons() {
    const directory = this.iconDirectory()
    if (!(await exists(directory))) return
    const referenced = new Set(
      this.document!.entries.flatMap((entry) =>
        [entry.iconId, entry.iconDarkId].filter((id): id is string => !!id),
      ),
    )
    for (const name of await readdir(directory))
      if (ICON_ID.test(name) && !referenced.has(name))
        await rm(join(directory, name), { force: true })
  }
  private async initialize() {
    await privateDirectory(this.cache)
    try {
      const raw = await readJson(join(this.cache, 'markets.json'))
      this.document = this.parseCache(raw)
      if (objectFields(raw).schemaVersion === 1)
        await atomicJson(this.cache, 'markets.json', this.document)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new PluginError(
          PLUGIN_ERROR_CODE.CORRUPT,
          '市场配置损坏，已保留原文件；请修复后重启服务。',
          500,
        )
      this.document = {
        schemaVersion: 2,
        updatedAt: '',
        markets: [],
        entries: [],
      }
    }
    try {
      await this.replace(await this.readMarket(this.root))
    } catch {
      this.errors.set('official', '官方市场读取失败，保留上次成功的目录。')
    }
  }
  /** 缓存同样是不可信输入，重建字段与身份而非直接强制转换。 */
  private parseCache(value: unknown): CatalogDocument {
    const doc = objectFields(value, [
      'schemaVersion',
      'updatedAt',
      'markets',
      'entries',
    ])
    if (
      (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) ||
      !Array.isArray(doc.markets) ||
      doc.markets.length > 21 ||
      !Array.isArray(doc.entries) ||
      doc.entries.length > 1000
    )
      throw new Error('invalid cache')
    const markets = doc.markets.map((value): PluginMarket => {
      const market = objectFields(value, [
        'id',
        'name',
        'builtIn',
        'format',
        'url',
        'ref',
        'path',
        'commit',
        'updatedAt',
      ])
      const name = nameField(market.name),
        id = textField(market.id, 80)
      const format = (market.format ?? PLUGIN_FORMAT.NATIVE) as PluginFormat
      if (!Object.values(PLUGIN_FORMAT).includes(format))
        throw new Error('invalid market format')
      const updatedAt = textField(market.updatedAt, 40)
      if (
        !Number.isFinite(Date.parse(updatedAt)) ||
        typeof market.builtIn !== 'boolean'
      )
        throw new Error('invalid market')
      if (market.builtIn) {
        if (id !== name || market.url !== undefined)
          throw new Error('invalid official market')
        return { id, name, builtIn: true, format, updatedAt }
      }
      const source = this.gitSource(market)
      if (id !== identity(`${source.url}:${source.path}`))
        throw new Error('invalid market identity')
      return {
        id,
        name,
        builtIn: false,
        format,
        ...source,
        commit: commitField(market.commit),
        updatedAt,
      }
    })
    if (
      new Set(markets.map((m) => m.id)).size !== markets.length ||
      markets.filter((m) => m.builtIn).length > 1
    )
      throw new Error('duplicate market')
    const entries = doc.entries.map((value): PluginCatalogEntry => {
      const record = objectFields(value, [
        'id',
        'name',
        'displayName',
        'description',
        'category',
        'version',
        'iconId',
        'iconDarkId',
        'authentication',
        'format',
        'market',
        'source',
      ])
      const market = markets.find((m) => m.id === record.market)
      if (!market) throw new Error('missing market')
      const metadata = this.metadata(
        { ...record, format: record.format ?? market.format },
        market.id,
      )
      if (record.id !== metadata.id) throw new Error('invalid entry identity')
      if (
        [record.iconId, record.iconDarkId].some(
          (id) =>
            id !== undefined && (typeof id !== 'string' || !ICON_ID.test(id)),
        )
      )
        throw new Error('invalid icon identity')
      const icons = {
        ...(record.iconId === undefined
          ? {}
          : { iconId: record.iconId as string }),
        ...(record.iconDarkId === undefined
          ? {}
          : { iconDarkId: record.iconDarkId as string }),
      }
      const from = objectFields(record.source, [
        'kind',
        'path',
        'url',
        'commit',
        'hash',
        'ref',
        'reason',
      ])
      const path = catalogPath(from.path ?? '.')
      if (from.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED) {
        if (doc.schemaVersion === 1 || typeof from.reason !== 'string')
          throw new Error('invalid unavailable source')
        return {
          ...metadata,
          ...icons,
          source: {
            kind: PLUGIN_SOURCE_KIND.UNSUPPORTED,
            path,
            reason: textField(from.reason, 200),
          },
        }
      }
      if (
        from.kind === PLUGIN_SOURCE_KIND.BUNDLED &&
        market.builtIn &&
        typeof from.hash === 'string' &&
        HASH_PATTERN.test(from.hash)
      )
        return {
          ...metadata,
          ...icons,
          source: { kind: PLUGIN_SOURCE_KIND.BUNDLED, path, hash: from.hash },
        }
      if (from.kind !== PLUGIN_SOURCE_KIND.GIT)
        throw new Error('invalid cached source')
      return {
        ...metadata,
        ...icons,
        source: {
          kind: PLUGIN_SOURCE_KIND.GIT,
          path,
          url: normalizeGitSource(textField(from.url), this.allowedHosts).url,
          ...(from.commit === undefined
            ? {}
            : { commit: commitField(from.commit) }),
          ...(from.ref === undefined ? {} : { ref: textField(from.ref, 200) }),
        },
      }
    })
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new Error('duplicate plugin')
    const updatedAt = textField(doc.updatedAt, 40)
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('invalid date')
    return { schemaVersion: 2, updatedAt, markets, entries }
  }
  private metadata(record: Record<string, unknown>, market: string) {
    const name = nameField(record.name),
      version =
        record.version === undefined ? undefined : versionField(record.version)
    const format = (record.format ?? PLUGIN_FORMAT.NATIVE) as PluginFormat
    if (!Object.values(PLUGIN_FORMAT).includes(format))
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '市场格式无效。')
    return {
      authentication:
        (record.authentication ??
          (record.policy
            ? objectFields(record.policy).authentication
            : undefined)) === MCP_AUTH_POLICY.ON_USE
          ? MCP_AUTH_POLICY.ON_USE
          : MCP_AUTH_POLICY.ON_INSTALL,
      id: identity(`${market}:${name}`),
      market,
      name,
      format,
      displayName: textField(record.displayName ?? name, 80),
      description: textField(record.description ?? '安装时读取插件说明'),
      category: textField(record.category ?? '其他', 40),
      version,
    }
  }
  private gitSource(value: Record<string, unknown>) {
    const source = normalizeGitSource(textField(value.url), this.allowedHosts)
    const ref = value.ref ? textField(value.ref, 200) : (source.ref ?? '')
    if (ref && (!/^[\w./-]{1,200}$/u.test(ref) || ref.startsWith('-')))
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '分支或标签无效。')
    const path =
      value.path === undefined || value.path === ''
        ? (source.path ?? '')
        : catalogPath(value.path)
    return { url: source.url, ref, path }
  }
  private async readMarket(
    root: string,
    source?: { url: string; ref: string; path: string; commit: string },
  ) {
    const base = source?.path ?? ''
    const candidates =
      !source || base.endsWith('.json')
        ? [source?.path ?? 'marketplace.json']
        : [
            posix.join(base, 'marketplace.json'),
            posix.join(base, '.agents/plugins/marketplace.json'),
            posix.join(base, '.claude-plugin/marketplace.json'),
          ]
    let selected: string | undefined
    for (const candidate of candidates) {
      const normalized = catalogPath(candidate)
      if (await exists(join(root, normalized))) {
        selected = normalized
        break
      }
    }
    if (!selected)
      throw new PluginError(
        PLUGIN_ERROR_CODE.INVALID,
        '未找到市场目录；支持 marketplace.json、.agents/plugins/marketplace.json 和 .claude-plugin/marketplace.json。',
      )
    const doc = objectFields(
      await readJson(await resolveContentPath(root, selected)),
    )
    if (!Array.isArray(doc.plugins) || doc.plugins.length > 1000)
      throw new PluginError(
        PLUGIN_ERROR_CODE.INVALID,
        '市场目录无效或条目过多。',
      )
    const format: PluginFormat =
      doc.schemaVersion === 1
        ? PLUGIN_FORMAT.NATIVE
        : selected.includes('.agents/plugins/')
          ? PLUGIN_FORMAT.CODEX
          : selected.includes('.claude-plugin/')
            ? PLUGIN_FORMAT.CLAUDE_CODE
            : doc.interface
              ? PLUGIN_FORMAT.CODEX
              : doc.owner || doc.$schema
                ? PLUGIN_FORMAT.CLAUDE_CODE
                : (() => {
                    throw new PluginError(
                      PLUGIN_ERROR_CODE.INVALID,
                      '无法识别市场目录格式。',
                    )
                  })()
    if (format === PLUGIN_FORMAT.NATIVE)
      objectFields(doc, ['schemaVersion', 'name', 'plugins'])
    const name = nameField(doc.name),
      updatedAt = new Date().toISOString()
    const market: PluginMarket = {
      id: source ? identity(`${source.url}:${selected}`) : name,
      name,
      builtIn: !source,
      format,
      ...source,
      ...(source ? { path: selected } : {}),
      updatedAt,
    }
    const entries: PluginCatalogEntry[] = []
    const iconBudget = {
      used: await this.iconCacheBytes().catch(() => MAX_ICON_CACHE_BYTES),
    }
    for (const value of doc.plugins) {
      const record =
        format === PLUGIN_FORMAT.NATIVE
          ? objectFields(value, [
              'name',
              'displayName',
              'description',
              'category',
              'version',
              'source',
            ])
          : objectFields(value)
      let entrySource: PluginCatalogEntry['source']
      if (format === PLUGIN_FORMAT.NATIVE) {
        const from = objectFields(record.source, [
          'kind',
          'path',
          'url',
          'commit',
        ])
        const itemPath = catalogPath(from.path)
        if (from.kind === PLUGIN_SOURCE_KIND.BUNDLED) {
          const relative = catalogPath(posix.join(dirname(selected), itemPath))
          entrySource = source
            ? {
                kind: PLUGIN_SOURCE_KIND.GIT,
                path: relative,
                url: source.url,
                commit: source.commit,
              }
            : {
                kind: PLUGIN_SOURCE_KIND.BUNDLED,
                path: relative,
                hash: await inspectTree(
                  await resolveContentPath(root, relative),
                ),
              }
        } else if (from.kind === PLUGIN_SOURCE_KIND.GIT)
          entrySource = {
            kind: PLUGIN_SOURCE_KIND.GIT,
            path: itemPath,
            url: normalizeGitSource(textField(from.url), this.allowedHosts).url,
            commit: commitField(from.commit),
          }
        else
          throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件来源类型无效。')
      } else if (
        typeof record.source === 'string' &&
        record.source.startsWith('./')
      )
        entrySource = {
          kind: PLUGIN_SOURCE_KIND.GIT,
          path: catalogPath(record.source),
          url: source!.url,
          commit: source!.commit,
        }
      else if (typeof record.source === 'string')
        entrySource = {
          kind: PLUGIN_SOURCE_KIND.UNSUPPORTED,
          path: '.',
          reason: '该字符串插件来源当前不支持',
        }
      else {
        const from = objectFields(record.source)
        const kind = from.source
        if (kind === 'local' && typeof from.path === 'string')
          entrySource = {
            kind: PLUGIN_SOURCE_KIND.GIT,
            path: catalogPath(from.path),
            url: source!.url,
            commit: source!.commit,
          }
        else if (kind === 'url' || kind === 'git-subdir' || kind === 'github') {
          const inputUrl =
            kind === 'github' ? textField(from.repo) : textField(from.url)
          const url = normalizeGitSource(inputUrl, this.allowedHosts).url
          const path = kind === 'git-subdir' ? catalogPath(from.path) : '.'
          const ref = from.ref === undefined ? '' : textField(from.ref, 200)
          if (ref && (!/^[\w./-]+$/u.test(ref) || ref.startsWith('-')))
            throw new PluginError(
              PLUGIN_ERROR_CODE.INVALID,
              '插件来源 ref 无效。',
            )
          const sameRepository =
            url.replace(/\.git\/?$/u, '').replace(/\/$/u, '') ===
            source!.url.replace(/\.git\/?$/u, '').replace(/\/$/u, '')
          entrySource = {
            kind: PLUGIN_SOURCE_KIND.GIT,
            path,
            url,
            ...(from.sha !== undefined
              ? { commit: commitField(from.sha) }
              : sameRepository
                ? { commit: source!.commit }
                : ref
                  ? { ref }
                  : {}),
          }
        } else
          entrySource = {
            kind: PLUGIN_SOURCE_KIND.UNSUPPORTED,
            path: '.',
            reason: `来源 ${String(kind ?? 'unknown')} 当前不支持`,
          }
      }
      let pluginRoot: string | undefined
      if (
        format === PLUGIN_FORMAT.CODEX &&
        typeof record.policy === 'object' &&
        record.policy !== null &&
        objectFields(record.policy).installation === 'NOT_AVAILABLE'
      )
        entrySource = {
          kind: PLUGIN_SOURCE_KIND.UNSUPPORTED,
          path: '.',
          reason: '市场声明此插件不可安装',
        }
      let summary: Awaited<ReturnType<typeof externalMetadata>> | undefined
      if (
        format !== PLUGIN_FORMAT.NATIVE &&
        entrySource.kind === PLUGIN_SOURCE_KIND.GIT &&
        entrySource.commit === source?.commit &&
        (await exists(join(root, entrySource.path)))
      )
        pluginRoot = await resolveContentPath(root, entrySource.path)
      if (pluginRoot)
        summary = await externalMetadata(pluginRoot, format).catch(
          () => undefined,
        )
      const metadata = this.metadata(
        {
          ...record,
          format,
          version: summary?.version ?? record.version,
          displayName: record.displayName ?? summary?.displayName,
          description:
            format === PLUGIN_FORMAT.NATIVE
              ? record.description
              : (externalDescription(record.description) ??
                summary?.description),
        },
        market.id,
      )
      const iconId = pluginRoot
        ? await this.cacheIcon(pluginRoot, summary?.logoPath, iconBudget)
        : undefined
      const iconDarkId = pluginRoot
        ? await this.cacheIcon(pluginRoot, summary?.logoDarkPath, iconBudget)
        : undefined
      entries.push({
        ...metadata,
        ...(iconId ? { iconId } : {}),
        ...(iconDarkId ? { iconDarkId } : {}),
        source: entrySource,
      })
    }
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '市场包含重复插件。')
    return { market, entries }
  }
  private async download(
    source: { url: string; ref: string; path: string },
    signal: AbortSignal,
  ) {
    const temporary = await mkdtemp(join(this.cache, '.market-'))
    try {
      const root = join(temporary, 'repository')
      const commit = await fetchGit(
        source,
        root,
        AbortSignal.any([signal, this.controller.signal]),
        this.allowedHosts,
      )
      return await this.readMarket(root, { ...source, commit })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  private async replace({
    market,
    entries,
  }: {
    market: PluginMarket
    entries: PluginCatalogEntry[]
  }) {
    const replacedIds = new Set(
      this.document!.markets.filter(
        (m) => m.id === market.id || (m.builtIn && market.builtIn),
      ).map((m) => m.id),
    )
    const document: CatalogDocument = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      markets: [
        ...this.document!.markets.filter(
          (m) => m.id !== market.id && !(market.builtIn && m.builtIn),
        ),
        market,
      ],
      entries: [
        ...this.document!.entries.filter((e) => !replacedIds.has(e.market)),
        ...entries,
      ],
    }
    if (document.entries.length > 1000)
      throw new PluginError(
        PLUGIN_ERROR_CODE.LIMIT,
        '所有市场合计最多支持 1000 个插件。',
      )
    await atomicJson(this.cache, 'markets.json', document)
    this.document = document
    await this.cleanIcons().catch(() => undefined)
    this.errors.delete(market.id)
    if (market.builtIn) this.errors.delete('official')
  }
  private serialize<T>(operation: () => Promise<T>) {
    const result = this.pending.then(async () => {
      await this.ensure()
      this.controller.signal.throwIfAborted()
      return operation()
    })
    this.pending = result.catch(() => undefined)
    return result
  }
  /** 校验并获取完整市场后一次保存；失败保留此前的来源列表。 */
  add(value: unknown, signal = new AbortController().signal) {
    return this.serialize(async () => {
      if (this.document!.markets.filter((m) => !m.builtIn).length >= 20)
        throw new PluginError(
          PLUGIN_ERROR_CODE.LIMIT,
          '最多添加 20 个插件市场。',
        )
      const source = this.gitSource(objectFields(value, ['url', 'ref', 'path']))
      const result = await this.download(source, signal)
      if (this.document!.markets.some((m) => m.id === result.market.id))
        throw new PluginError(
          PLUGIN_ERROR_CODE.CONFLICT,
          '该插件市场已添加。',
          409,
        )
      signal.throwIfAborted()
      await this.replace(result)
      return structuredClone(result.market)
    })
  }
  /** 单独刷新指定来源，网络失败保留该市场的已验证条目。 */
  refreshMarket(id: string, signal = new AbortController().signal) {
    return this.serialize(async () => {
      const market = this.document!.markets.find((m) => m.id === id)
      if (!market)
        throw new PluginError(PLUGIN_ERROR_CODE.NOT_FOUND, '市场不存在。', 404)
      try {
        const result = market.builtIn
          ? await this.readMarket(this.root)
          : await this.download(
              this.gitSource({
                url: market.url,
                ref: market.ref,
                path: market.path,
              }),
              signal,
            )
        signal.throwIfAborted()
        await this.replace(result)
      } catch (error) {
        this.errors.set(id, '刷新失败，保留上次成功的目录。')
        throw error
      }
    })
  }
  /** 移除目录来源，保留已安装插件、配置和可回退版本。 */
  removeMarket(id: string) {
    return this.serialize(async () => {
      const market = this.document!.markets.find((m) => m.id === id)
      if (!market)
        throw new PluginError(PLUGIN_ERROR_CODE.NOT_FOUND, '市场不存在。', 404)
      if (market.builtIn)
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '官方市场不能移除。')
      const document = {
        ...this.document!,
        markets: this.document!.markets.filter((m) => m.id !== id),
        entries: this.document!.entries.filter((e) => e.market !== id),
        updatedAt: new Date().toISOString(),
      }
      await atomicJson(this.cache, 'markets.json', document)
      this.document = document
      await this.cleanIcons().catch(() => undefined)
      this.errors.delete(id)
    })
  }
  async refresh() {
    await this.ensure()
    for (const market of this.document!.markets)
      await this.refreshMarket(market.id).catch(() => undefined)
  }
  async markets() {
    await this.ensure()
    return this.document!.markets.map((market) => {
      const entries = this.document!.entries.filter(
        (e) => e.market === market.id,
      )
      return {
        ...structuredClone(market),
        pluginCount: entries.length,
        ...(!market.builtIn && entries.length === 1
          ? { iconId: entries[0]?.iconId, iconDarkId: entries[0]?.iconDarkId }
          : {}),
        error:
          this.errors.get(market.id) ??
          (market.builtIn ? this.errors.get('official') : undefined),
      }
    })
  }
  async list(query = '', category = '', offset = 0, limit = 50, market = '') {
    await this.ensure()
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      query.length > 200
    )
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '市场查询条件无效。')
    const entries = this.document!.entries
    const search = query.trim().toLocaleLowerCase()
    const matched = entries.filter(
      (entry) =>
        (!market || entry.market === market) &&
        (!category || entry.category === category) &&
        `${entry.displayName} ${entry.name} ${entry.description}`
          .toLocaleLowerCase()
          .includes(search),
    )
    return {
      entries: structuredClone(matched.slice(offset, offset + limit)),
      total: matched.length,
      categories: [...new Set(entries.map((entry) => entry.category))],
      markets: await this.markets(),
      updatedAt: this.document!.updatedAt,
      error: [...this.errors.values()].join(' ') || undefined,
    }
  }
  async get(id: string) {
    await this.ensure()
    const entry = this.document!.entries.find((entry) => entry.id === id)
    if (!entry)
      throw new PluginError(
        PLUGIN_ERROR_CODE.NOT_FOUND,
        '市场插件不存在，请刷新目录。',
        404,
      )
    return structuredClone(entry)
  }
  async icon(id: string) {
    await this.ensure()
    if (
      !ICON_ID.test(id) ||
      !this.document!.entries.some(
        (entry) => entry.iconId === id || entry.iconDarkId === id,
      )
    )
      throw new PluginError(PLUGIN_ERROR_CODE.NOT_FOUND, '图标不存在。', 404)
    try {
      const path = join(this.iconDirectory(), id)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ICON_BYTES)
        throw new Error('invalid icon file')
      const bytes = await readFile(path)
      const type = iconMime(bytes)
      if (
        !type ||
        !id.endsWith(`.${type.ext}`) ||
        `${createHash('sha256').update(bytes).digest('hex')}.${type.ext}` !== id
      )
        throw new Error('invalid icon contents')
      return { bytes, mime: type.mime }
    } catch {
      throw new PluginError(PLUGIN_ERROR_CODE.NOT_FOUND, '图标不存在。', 404)
    }
  }
  async close() {
    this.controller.abort()
    await this.pending
  }
}
