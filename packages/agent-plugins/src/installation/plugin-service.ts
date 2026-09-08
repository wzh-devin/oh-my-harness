import { randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  detectCandidates,
  parseMarketplace,
  parsePlugin,
} from '../manifest/parse.ts'
import {
  PluginError,
  type CatalogEntry,
  type ImportCandidate,
  type MarketplaceDescriptor,
  type PluginDescriptor,
  type PluginSource,
} from '../manifest/types.ts'
import { exists, inspectTree, resolveContentPath } from '../source/files.ts'
import { extractZip, fetchGit, normalizeGitSource } from '../source/fetch.ts'
import {
  PLUGIN_COLLECTION_KIND,
  PLUGIN_IMPORT_KIND,
  PLUGIN_IMPORT_STATUS,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_REGISTRY_ITEM_KIND,
  PLUGIN_SOURCE_TYPE,
  type PluginCollectionKind,
  type PluginImportStatus,
  type PluginRegistryItemKind,
} from '@oh-my-harness/shared'

type SourceSnapshot = {
  source: PluginSource
  candidate: ImportCandidate
  definition?: Record<string, unknown>
}
export type PluginRevision = {
  id: string
  contentDigest: string
  resolvedCommit?: string
  descriptor: PluginDescriptor
  sourceSnapshot: SourceSnapshot
}
export type PluginInstallation = {
  id: string
  enabled: boolean
  activeRevision: PluginRevision
  previousRevision?: PluginRevision
  catalogEntryId?: string
}
export type PluginMarketplace = {
  id: string
  revision: string
  descriptor: MarketplaceDescriptor
  sourceSnapshot: SourceSnapshot
}
type Registry = {
  schemaVersion: 1
  generation: number
  marketplaces: PluginMarketplace[]
  installations: PluginInstallation[]
}
export type PluginImport = {
  id: string
  status: PluginImportStatus
  candidates: ImportCandidate[]
  error?: string
}
type ImportState = PluginImport & {
  directory: string
  source: PluginSource
  resolvedCommit?: string
  controller: AbortController
  expires: number
  work?: Promise<void>
}
export type PluginSnapshot = PluginInstallation & { rootDirectory: string }

/** 按市场与稳定条目 ID 查询唯一安装事实。 */
export const findCatalogInstallation = (
  installations: readonly PluginInstallation[],
  marketplaceId: string,
  entryId: string,
) =>
  installations.find(
    (item) => item.catalogEntryId === `${marketplaceId}:${entryId}`,
  )

/** 管理导入暂存、幂等安装、不可变版本及运行中的资源租约。 */
export class PluginService {
  readonly directory: string
  private registry: Registry = {
    schemaVersion: 1,
    generation: 0,
    marketplaces: [],
    installations: [],
  }
  private readonly imports = new Map<string, ImportState>()
  private readonly leases = new Map<string, number>()
  private mutations: Promise<unknown> = Promise.resolve()
  private readonly ready: Promise<void>
  private readonly allowedGitHosts: string[]
  private closed = false

  constructor(
    dataDirectory: string,
    allowedGitHosts = ['github.com', 'gitlab.com', 'bitbucket.org'],
  ) {
    this.directory = join(dataDirectory, 'plugins')
    this.allowedGitHosts = allowedGitHosts
    this.ready = this.initialize()
  }

  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const path = join(this.directory, 'registry.json')
    if (await exists(path)) {
      try {
        const registry = JSON.parse(await readFile(path, 'utf8')) as Registry
        if (
          registry.schemaVersion !== 1 ||
          !Number.isSafeInteger(registry.generation) ||
          !Array.isArray(registry.marketplaces) ||
          !Array.isArray(registry.installations)
        )
          throw new Error('schema')
        for (const record of [
          ...registry.marketplaces,
          ...registry.installations,
        ]) {
          if (!/^[\w-]{1,100}$/.test(record.id)) throw new Error('id')
          const revision =
            'revision' in record ? record.revision : record.activeRevision.id
          if (
            !/^[\w-]{1,100}$/.test(revision) ||
            !(await exists(
              join(
                this.directory,
                'revision' in record
                  ? PLUGIN_COLLECTION_KIND.MARKETPLACES
                  : PLUGIN_COLLECTION_KIND.INSTALLATIONS,
                record.id,
                revision,
              ),
            ))
          )
            throw new Error('missing revision')
          if ('activeRevision' in record) {
            if (typeof record.enabled !== 'boolean') throw new Error('enabled')
            for (const item of [
              record.activeRevision,
              record.previousRevision,
            ].filter((item): item is PluginRevision => !!item)) {
              if (
                !/^[\w-]{1,100}$/.test(item.id) ||
                !/^[a-f0-9]{64}$/.test(item.contentDigest) ||
                !item.descriptor ||
                !item.sourceSnapshot
              )
                throw new Error('revision')
              await resolveContentPath(
                this.directory,
                join(PLUGIN_COLLECTION_KIND.INSTALLATIONS, record.id, item.id),
              )
            }
          }
        }
        this.registry = registry
      } catch {
        throw new PluginError(
          'PLUGIN_REGISTRY_CORRUPT',
          '插件注册表损坏或内容缺失，已停止加载；原数据未被覆盖',
          500,
        )
      }
    }
    // Staging never contains committed state and cannot survive a server restart.
    const staging = join(this.directory, 'staging')
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { mode: 0o700 })
    await this.collect()
  }

  private async mutate<T>(
    change: (registry: Registry) => Promise<T> | T,
  ): Promise<T> {
    await this.ready
    const operation = this.mutations.then(async () => {
      const next = structuredClone(this.registry)
      const result = await change(next)
      next.generation++
      const path = join(this.directory, `registry-${randomUUID()}.tmp`)
      const handle = await open(path, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(next))
        await handle.sync()
        await handle.close()
        await rename(path, join(this.directory, 'registry.json'))
      } finally {
        await handle.close().catch(() => undefined)
        await rm(path, { force: true })
      }
      this.registry = next
      return result
    })
    this.mutations = operation.catch(() => undefined)
    return operation
  }

  async list() {
    await this.ready
    return structuredClone(this.registry)
  }

  async createImport(
    input:
      | { url: string; ref?: string; path?: string }
      | { zip: Buffer; name: string },
  ) {
    await this.ready
    if (this.closed)
      throw new PluginError('PLUGIN_SERVICE_CLOSED', '插件服务已关闭', 503)
    for (const [id, value] of this.imports)
      if (value.expires < Date.now()) await this.cancelImport(id)
    if (this.imports.size >= 20)
      throw new PluginError(
        'PLUGIN_IMPORT_LIMIT',
        '待处理导入过多，请先取消或完成现有导入',
        429,
      )
    const id = randomUUID()
    const source: PluginSource =
      PLUGIN_SOURCE_TYPE.ZIP in input
        ? { type: PLUGIN_SOURCE_TYPE.ZIP, name: input.name.slice(0, 200) }
        : {
            ...normalizeGitSource(input.url, this.allowedGitHosts),
            ...(input.ref ? { ref: input.ref } : {}),
            ...(input.path ? { path: input.path } : {}),
          }
    const state: ImportState = {
      id,
      source,
      status: PLUGIN_IMPORT_STATUS.FETCHING,
      candidates: [],
      directory: join(this.directory, 'staging', id),
      controller: new AbortController(),
      expires: Date.now() + 30 * 60_000,
    }
    this.imports.set(id, state)
    state.work = (async () => {
      try {
        await mkdir(state.directory, { mode: 0o700 })
        const content = join(state.directory, 'content')
        if (PLUGIN_SOURCE_TYPE.ZIP in input) {
          await mkdir(content, { mode: 0o700 })
          await extractZip(input.zip, content, state.controller.signal)
        } else
          state.resolvedCommit = await fetchGit(
            source as Extract<
              PluginSource,
              { type: typeof PLUGIN_SOURCE_TYPE.GIT }
            >,
            content,
            state.controller.signal,
            this.allowedGitHosts,
          )
        await inspectTree(content)
        const searchRoot =
          source.type === PLUGIN_SOURCE_TYPE.GIT && source.path
            ? await resolveContentPath(content, source.path)
            : content
        state.candidates = (await detectCandidates(searchRoot)).map(
          (candidate) => ({
            ...candidate,
            root: relative(content, join(searchRoot, candidate.root)) || '.',
          }),
        )
        state.controller.signal.throwIfAborted()
        state.status = PLUGIN_IMPORT_STATUS.READY
      } catch (error) {
        state.status = state.controller.signal.aborted
          ? PLUGIN_IMPORT_STATUS.CANCELLED
          : PLUGIN_IMPORT_STATUS.FAILED
        state.error =
          error instanceof PluginError
            ? error.message
            : '导入失败：包内容或清单无效'
        await rm(state.directory, { recursive: true, force: true })
      }
    })()
    return this.getImport(id)
  }

  getImport(id: string): PluginImport {
    const state = this.imports.get(id)
    if (!state)
      throw new PluginError(
        'PLUGIN_IMPORT_NOT_FOUND',
        '导入不存在或已过期',
        404,
      )
    return {
      id,
      status: state.status,
      candidates: state.candidates,
      ...(state.error ? { error: state.error } : {}),
    }
  }

  async cancelImport(id: string) {
    const state = this.imports.get(id)
    if (!state) return
    state.controller.abort()
    state.status = PLUGIN_IMPORT_STATUS.CANCELLED
    this.imports.delete(id)
    await state.work
    await rm(state.directory, { recursive: true, force: true })
  }

  private importCandidate(id: string, key: string) {
    const state = this.imports.get(id)
    const candidate = state?.candidates.find(
      (candidate) => candidate.key === key,
    )
    if (
      !state ||
      state.status !== PLUGIN_IMPORT_STATUS.READY ||
      !candidate ||
      state.expires < Date.now()
    )
      throw new PluginError('PLUGIN_IMPORT_NOT_READY', '导入尚未就绪或入口无效')
    return {
      state,
      candidate,
      root: join(state.directory, 'content', candidate.root),
    }
  }

  async preview(id: string, key: string) {
    const { candidate, root } = this.importCandidate(id, key)
    return candidate.kind === PLUGIN_IMPORT_KIND.MARKETPLACE
      ? parseMarketplace(root, candidate.format, this.allowedGitHosts)
      : parsePlugin(root, candidate.format)
  }

  private async copyRevision(
    root: string,
    kind: PluginCollectionKind,
    id: string,
    revision: string,
  ) {
    if (!/^[\w-]{1,100}$/.test(id) || !/^[\w-]{1,100}$/.test(revision))
      throw new PluginError('PLUGIN_ID_INVALID', '安装身份无效')
    const destination = join(this.directory, kind, id, revision)
    await mkdir(join(this.directory, kind, id), {
      recursive: true,
      mode: 0o700,
    })
    await cp(root, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (source) => !source.split('/').includes('.git'),
    })
    async function secure(dir: string) {
      await chmod(dir, 0o700)
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.isDirectory()) await secure(join(dir, item.name))
        else await chmod(join(dir, item.name), 0o600)
      }
    }
    await secure(destination)
    return destination
  }

  async registerMarketplace(importId: string, key: string, replaceId?: string) {
    const { state, candidate, root } = this.importCandidate(importId, key)
    if (candidate.kind !== PLUGIN_IMPORT_KIND.MARKETPLACE)
      throw new PluginError('PLUGIN_IMPORT_KIND', '请选择市场入口')
    const descriptor = await parseMarketplace(
      root,
      candidate.format,
      this.allowedGitHosts,
    )
    const id = replaceId ?? randomUUID()
    const revision = randomUUID()
    await this.copyRevision(
      root,
      PLUGIN_COLLECTION_KIND.MARKETPLACES,
      id,
      revision,
    )
    const record: PluginMarketplace = {
      id,
      revision,
      descriptor,
      sourceSnapshot: { source: state.source, candidate },
    }
    await this.mutate((registry) => {
      if (
        replaceId &&
        !registry.marketplaces.some((item) => item.id === replaceId)
      )
        throw new PluginError('PLUGIN_MARKET_NOT_FOUND', '市场已移除', 404)
      registry.marketplaces = [
        ...registry.marketplaces.filter((item) => item.id !== id),
        record,
      ]
    })
    return record
  }

  async installImport(importId: string, key: string, replaceId?: string) {
    const { state, candidate, root } = this.importCandidate(importId, key)
    if (candidate.kind !== PLUGIN_IMPORT_KIND.PLUGIN)
      throw new PluginError('PLUGIN_IMPORT_KIND', '请选择插件入口')
    return this.install(
      root,
      { source: state.source, candidate },
      state.resolvedCommit,
      undefined,
      replaceId,
    )
  }

  private async install(
    root: string,
    sourceSnapshot: SourceSnapshot,
    resolvedCommit?: string,
    catalogEntryId?: string,
    replaceId?: string,
  ) {
    const descriptor = await parsePlugin(
      root,
      sourceSnapshot.candidate.format,
      sourceSnapshot.definition,
    )
    const id = replaceId ?? randomUUID()
    const revision: PluginRevision = {
      id: randomUUID(),
      contentDigest: await inspectTree(root),
      descriptor,
      resolvedCommit,
      sourceSnapshot,
    }
    await this.copyRevision(
      root,
      PLUGIN_COLLECTION_KIND.INSTALLATIONS,
      id,
      revision.id,
    )
    const result = await this.mutate((registry) => {
      if (!replaceId) {
        const separator = catalogEntryId?.indexOf(':') ?? -1
        const installed = catalogEntryId
          ? findCatalogInstallation(
              registry.installations,
              catalogEntryId.slice(0, separator),
              catalogEntryId.slice(separator + 1),
            )
          : registry.installations.find(
              (item) =>
                item.activeRevision.contentDigest === revision.contentDigest &&
                item.activeRevision.descriptor.name === descriptor.name,
            )
        if (installed) return structuredClone(installed)
      }
      const previous = registry.installations.find((item) => item.id === id)
      if (replaceId && !previous)
        throw new PluginError(
          'PLUGIN_INSTALLATION_NOT_FOUND',
          '插件已卸载',
          404,
        )
      const record: PluginInstallation = {
        id,
        enabled: previous?.enabled === true && !descriptor.blocked,
        activeRevision: revision,
        ...(previous ? { previousRevision: previous.activeRevision } : {}),
        catalogEntryId: catalogEntryId ?? previous?.catalogEntryId,
      }
      registry.installations = [
        ...registry.installations.filter((item) => item.id !== id),
        record,
      ]
      return structuredClone(record)
    })
    if (result.id !== id)
      await rm(
        join(
          this.directory,
          PLUGIN_COLLECTION_KIND.INSTALLATIONS,
          id,
          revision.id,
        ),
        {
          recursive: true,
          force: true,
        },
      )
    return result
  }

  async installCatalog(marketplaceId: string, entryId: string) {
    await this.ready
    const market = this.registry.marketplaces.find(
      (item) => item.id === marketplaceId,
    )
    const entry = market?.descriptor.entries.find((item) => item.id === entryId)
    if (!market || !entry?.source)
      throw new PluginError(
        'PLUGIN_ENTRY_NOT_FOUND',
        '条目不存在或来源不受支持',
        404,
      )
    const installed = findCatalogInstallation(
      this.registry.installations,
      market.id,
      entry.id,
    )
    if (installed) return structuredClone(installed)
    return this.installEntry(market, entry)
  }

  private async installEntry(market: PluginMarketplace, entry: CatalogEntry) {
    if (entry.source!.type === PLUGIN_SOURCE_TYPE.PATH) {
      const marketRoot = join(
        this.directory,
        PLUGIN_COLLECTION_KIND.MARKETPLACES,
        market.id,
        market.revision,
      )
      const root = await resolveContentPath(marketRoot, entry.source!.path)
      const candidates = await detectCandidates(root).catch((error) => {
        if (entry.definition) return []
        throw error
      })
      const candidate =
        this.catalogCandidate(candidates, market.descriptor.format) ??
        (entry.definition
          ? {
              key: '.:claude:plugin',
              kind: PLUGIN_IMPORT_KIND.PLUGIN,
              format: PLUGIN_MANIFEST_FORMAT.CLAUDE,
              root: '.',
            }
          : undefined)
      if (!candidate)
        throw new PluginError('PLUGIN_ENTRY_NOT_FOUND', '条目没有插件入口')
      const source = market.sourceSnapshot.source
      const path = join(
        market.sourceSnapshot.candidate.root,
        entry.source!.path,
        candidate.root,
      )
      return this.install(
        join(root, candidate.root),
        {
          source,
          candidate: { ...candidate, root: path },
          definition: entry.definition,
        },
        undefined,
        `${market.id}:${entry.id}`,
      )
    }
    if (entry.source!.type !== PLUGIN_SOURCE_TYPE.GIT)
      throw new PluginError('PLUGIN_SOURCE_UNSUPPORTED', '不支持此来源')
    const imported = await this.importReady(entry.source!)
    try {
      const candidate = this.catalogCandidate(
        imported.candidates,
        market.descriptor.format,
      )
      if (!candidate)
        throw new PluginError('PLUGIN_ENTRY_NOT_FOUND', '条目没有插件入口')
      return await this.install(
        join(imported.directory, 'content', candidate.root),
        { source: imported.source, candidate, definition: entry.definition },
        imported.resolvedCommit,
        `${market.id}:${entry.id}`,
      )
    } finally {
      await this.cancelImport(imported.id)
    }
  }

  private async importReady(
    source: Extract<PluginSource, { type: typeof PLUGIN_SOURCE_TYPE.GIT }>,
  ) {
    const imported = await this.createImport(source)
    const state = this.imports.get(imported.id)!
    await state.work
    if (state.status !== PLUGIN_IMPORT_STATUS.READY) {
      await this.cancelImport(state.id)
      throw new PluginError('PLUGIN_FETCH_FAILED', state.error ?? '获取失败')
    }
    return state
  }

  private catalogCandidate(
    candidates: ImportCandidate[],
    format: ImportCandidate['format'],
  ) {
    const plugins = candidates.filter(
      (item) => item.kind === PLUGIN_IMPORT_KIND.PLUGIN,
    )
    const matching = plugins.filter((item) => item.format === format)
    const choices = matching.length ? matching : plugins
    if (choices.length > 1)
      throw new PluginError(
        'PLUGIN_ENTRY_AMBIGUOUS',
        '条目有多个插件入口，请通过直接导入选择具体入口',
      )
    return choices[0]
  }

  async refreshMarketplace(id: string) {
    await this.ready
    const market = this.registry.marketplaces.find((item) => item.id === id)
    if (!market)
      throw new PluginError('PLUGIN_MARKET_NOT_FOUND', '市场不存在', 404)
    if (market.sourceSnapshot.source.type !== PLUGIN_SOURCE_TYPE.GIT)
      throw new PluginError(
        'PLUGIN_ZIP_REIMPORT_REQUIRED',
        'ZIP 市场请重新导入后替换',
      )
    const state = await this.importReady(market.sourceSnapshot.source)
    try {
      const candidate = state.candidates.find(
        (item) =>
          item.kind === PLUGIN_IMPORT_KIND.MARKETPLACE &&
          item.root === market.sourceSnapshot.candidate.root &&
          item.format === market.descriptor.format,
      )
      if (!candidate)
        throw new PluginError('PLUGIN_ENTRY_NOT_FOUND', '原市场入口已消失')
      return await this.registerMarketplace(state.id, candidate.key, id)
    } finally {
      await this.cancelImport(state.id)
    }
  }

  async updateInstallation(id: string) {
    await this.ready
    const installed = this.registry.installations.find((item) => item.id === id)
    if (!installed)
      throw new PluginError('PLUGIN_INSTALLATION_NOT_FOUND', '插件不存在', 404)
    const snapshot = installed.activeRevision.sourceSnapshot
    if (snapshot.source.type !== PLUGIN_SOURCE_TYPE.GIT)
      throw new PluginError(
        'PLUGIN_ZIP_REIMPORT_REQUIRED',
        'ZIP 插件请重新导入后替换',
      )
    const state = await this.importReady(snapshot.source)
    try {
      const root = await resolveContentPath(
        join(state.directory, 'content'),
        snapshot.candidate.root,
      )
      return await this.install(
        root,
        snapshot,
        state.resolvedCommit,
        installed.catalogEntryId,
        id,
      )
    } finally {
      await this.cancelImport(state.id)
    }
  }

  async setEnabled(id: string, enabled: boolean) {
    return this.mutate((registry) => {
      const item = registry.installations.find((item) => item.id === id)
      if (!item)
        throw new PluginError(
          'PLUGIN_INSTALLATION_NOT_FOUND',
          '插件不存在',
          404,
        )
      if (enabled && item.activeRevision.descriptor.blocked)
        throw new PluginError(
          'PLUGIN_DEPENDENCY_UNSUPPORTED',
          '插件依赖未支持的宿主能力，不能启用',
        )
      item.enabled = enabled
    })
  }

  async rollback(id: string) {
    return this.mutate((registry) => {
      const item = registry.installations.find((item) => item.id === id)
      if (!item?.previousRevision)
        throw new PluginError('PLUGIN_ROLLBACK_UNAVAILABLE', '没有可回滚的版本')
      ;[item.activeRevision, item.previousRevision] = [
        item.previousRevision,
        item.activeRevision,
      ]
      if (item.activeRevision.descriptor.blocked) item.enabled = false
    })
  }

  async remove(id: string, kind: PluginRegistryItemKind) {
    await this.mutate((registry) => {
      if (kind === PLUGIN_REGISTRY_ITEM_KIND.MARKETPLACE)
        registry.marketplaces = registry.marketplaces.filter(
          (item) => item.id !== id,
        )
      else
        registry.installations = registry.installations.filter(
          (item) => item.id !== id,
        )
    })
    // Revisions are reclaimed at startup, after all previous Runs have ended.
  }

  async snapshot(ids: string[]) {
    await this.ready
    const installations: PluginSnapshot[] = [...new Set(ids)].map((id) => {
      const record = this.registry.installations.find((item) => item.id === id)
      if (!record?.enabled || record.activeRevision.descriptor.blocked)
        throw new PluginError(
          'PLUGIN_NOT_AVAILABLE',
          '选用的插件已禁用、卸载或不可用',
        )
      return {
        ...structuredClone(record),
        rootDirectory: join(
          this.directory,
          PLUGIN_COLLECTION_KIND.INSTALLATIONS,
          id,
          record.activeRevision.id,
        ),
      }
    })
    for (const item of installations)
      this.leases.set(
        item.rootDirectory,
        (this.leases.get(item.rootDirectory) ?? 0) + 1,
      )
    let released = false
    return {
      installations,
      release: async () => {
        if (released) return
        released = true
        for (const item of installations) {
          const count = (this.leases.get(item.rootDirectory) ?? 1) - 1
          if (count) this.leases.set(item.rootDirectory, count)
          else this.leases.delete(item.rootDirectory)
        }
        // ponytail: startup-only GC avoids racing prepared-but-uncommitted revisions.
        // Add serialized online GC if retained update revisions become significant.
      },
    }
  }

  private async collect() {
    for (const kind of [
      PLUGIN_COLLECTION_KIND.MARKETPLACES,
      PLUGIN_COLLECTION_KIND.INSTALLATIONS,
    ] as const) {
      const root = join(this.directory, kind)
      if (!(await exists(root))) continue
      const keep = new Set<string>()
      if (kind === PLUGIN_COLLECTION_KIND.MARKETPLACES)
        for (const item of this.registry.marketplaces)
          keep.add(join(root, item.id, item.revision))
      else
        for (const item of this.registry.installations) {
          keep.add(join(root, item.id, item.activeRevision.id))
          if (item.previousRevision)
            keep.add(join(root, item.id, item.previousRevision.id))
        }
      for (const id of await readdir(root))
        for (const revision of await readdir(join(root, id))) {
          const path = join(root, id, revision)
          if (!keep.has(path) && !this.leases.has(path))
            await rm(path, { recursive: true, force: true })
        }
    }
  }

  async close() {
    this.closed = true
    for (const state of this.imports.values()) state.controller.abort()
    await Promise.all([...this.imports.values()].map((state) => state.work))
    await this.mutations
  }
}
