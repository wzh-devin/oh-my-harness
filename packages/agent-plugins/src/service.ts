import { createHash, randomUUID } from 'node:crypto'
import { chmod, cp, lstat, readdir, rename, rm } from 'node:fs/promises'
import { join, basename, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_ERROR_CODE,
  PLUGIN_INSTALLATION_SOURCE_KIND,
  PLUGIN_OPERATION_STATUS,
  PLUGIN_SOURCE_KIND,
  type PluginOperationStatus,
} from '@oh-my-harness/shared'
import { PluginError } from './error.ts'
import { SourceError } from './source/error.ts'
import { fetchGit, normalizeGitSource } from './source/fetch.ts'
import {
  inspectTree,
  relativePath,
  resolveContentPath,
} from './source/files.ts'
import {
  configuredServers,
  inspectManifest,
  externalMetadata,
  objectFields,
  textField,
  type PluginManifest,
  type PluginSkill,
} from './manifest/manifest.ts'
import { PluginCatalog, type PluginCatalogEntry } from './catalog/catalog.ts'
import { runPluginHook } from './hooks/runner.ts'
import { readPluginIcon } from './source/icons.ts'

import {
  inputValues,
  PluginStore,
  privateDirectory,
  UUID_PATTERN,
  type PluginInstallation,
  type PluginInstallationSource,
  type PluginRelease,
} from './installation/store.ts'

export interface PluginInstallationInfo {
  id: string
  entryId: string
  source: PluginInstallationSource
  revision: number
  enabled: boolean
  hooksTrusted: boolean
  manifest: PluginManifest
  skills: PluginSkill[]
  configuredKeys: string[]
  missingKeys: string[]
  previousVersion?: string
  error?: string
}
export interface PluginOperation {
  id: string
  status: PluginOperationStatus
  source:
    | { kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
    | {
        kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
        url: string
        ref: string
        path: string
        commit?: string
      }
  entry?: PluginCatalogEntry
  manifest?: PluginManifest
  skills?: PluginSkill[]
  previousVersion?: string
  resetConfiguration?: boolean
  installationId?: string
  error?: string
}
interface Job {
  value: PluginOperation
  key: string
  controller: AbortController
  directory: string
  hash?: string
  revision: number
  work: Promise<void>
  timer: ReturnType<typeof setTimeout>
}
interface DirectPluginSource {
  url: string
  ref: string
  path: string
}
export interface PluginSkillRoot extends PluginSkill {
  id: string
  pluginId: string
  pluginName: string
  rootDirectory: string
}

const sameConfiguration = (left: PluginManifest, right: PluginManifest) =>
  JSON.stringify(left.mcpServers) === JSON.stringify(right.mcpServers) &&
  JSON.stringify(left.inputs) === JSON.stringify(right.inputs)
const missingInputs = (release: PluginRelease) =>
  release.manifest.inputs
    .filter((input) => input.required && !release.values[input.key]?.trim())
    .map((input) => input.key)
const sourceIdentity = (source: DirectPluginSource) =>
  createHash('sha256')
    .update(`direct:${source.url}:${source.ref}:${source.path}`)
    .digest('hex')

/** 管理本地插件包与安装状态，运行注册由应用装配到 Runtime 和 MCP。 */
export class PluginService {
  readonly catalog: PluginCatalog
  private readonly store: PluginStore
  private readonly jobs = new Map<string, Job>()
  private readonly invalid = new Map<string, string>()
  private readonly directory: string
  private readonly ready: Promise<void>
  private closed = false

  private readonly options: {
    marketplaceRoot?: string
    allowedGitHosts?: string[]
  }
  constructor(
    dataDirectory: string,
    options: {
      marketplaceRoot?: string
      allowedGitHosts?: string[]
    } = {},
  ) {
    this.options = options
    this.directory = join(dataDirectory, 'plugins')
    this.store = new PluginStore(this.directory)
    this.catalog = new PluginCatalog(
      options.marketplaceRoot ??
        fileURLToPath(new URL('../marketplace/', import.meta.url)),
      join(this.directory, 'catalog-cache'),
      options.allowedGitHosts,
    )
    this.ready = this.initialize()
  }
  private async initialize() {
    const state = await this.store.read()
    await privateDirectory(join(this.directory, 'packages'))
    await privateDirectory(join(this.directory, 'staging'))
    for (const entry of await readdir(join(this.directory, 'staging'), {
      withFileTypes: true,
    }))
      if (entry.isDirectory() && UUID_PATTERN.test(entry.name))
        await rm(join(this.directory, 'staging', entry.name), {
          recursive: true,
          force: true,
        })
    let migrated = false
    for (const installation of state.installations) {
      try {
        if (installation.normalizationVersion !== 2) {
          for (const release of [installation.current, installation.previous])
            if (release) {
              const root = this.releasePath(installation.id, release.hash)
              if ((await inspectTree(root)) !== release.hash)
                throw new Error('modified package')
              const parsed = await inspectManifest(
                root,
                release.manifest.format,
                release.hash,
                release.manifest.version,
              )
              release.manifest = parsed.manifest
              release.skills = parsed.skills
              for (const key of Object.keys(parsed.manifest.mcpServers))
                installation.serverIds[key] ??= randomUUID()
            }
          installation.normalizationVersion = 2
          migrated = true
        }
        await this.verify(installation)
      } catch {
        this.invalid.set(
          installation.id,
          '插件内容缺失或已被修改，已停止加载；请恢复原文件或卸载后重新安装。',
        )
      }
    }
    if (migrated)
      await this.store.write({ ...state, revision: state.revision + 1 })
  }
  private assertOpen() {
    if (this.closed)
      throw new PluginError(
        PLUGIN_ERROR_CODE.UNAVAILABLE,
        '插件服务已关闭。',
        503,
      )
  }
  private releasePath(id: string, hash: string) {
    return join(this.directory, 'packages', id, hash)
  }
  private async verify(
    installation: PluginInstallation,
    release = installation.current,
  ) {
    const root = await resolveContentPath(
      join(this.directory, 'packages'),
      `${installation.id}/${release.hash}`,
    )
    const parsed = await inspectManifest(
      root,
      release.manifest.format,
      release.hash,
      release.manifest.version,
    )
    if (
      JSON.stringify(parsed.manifest) !== JSON.stringify(release.manifest) ||
      JSON.stringify(parsed.skills) !== JSON.stringify(release.skills) ||
      (await inspectTree(root)) !== release.hash
    )
      throw new PluginError(
        PLUGIN_ERROR_CODE.CONTENT_CHANGED,
        '插件内容已被修改，请恢复原文件后重试；不会覆盖本地改动。',
        409,
      )
  }
  private info(installation: PluginInstallation): PluginInstallationInfo {
    const manifest = structuredClone(installation.current.manifest)
    for (const server of Object.values(manifest.mcpServers))
      if (server.oauth) delete server.oauth.client_secret
    return {
      id: installation.id,
      entryId: installation.entryId,
      source: structuredClone(installation.source),
      revision: installation.revision,
      enabled: installation.enabled,
      hooksTrusted: installation.trustedHookHash === installation.current.hash,
      manifest,
      skills: structuredClone(installation.current.skills),
      configuredKeys: Object.keys(installation.current.values),
      missingKeys: missingInputs(installation.current),
      previousVersion: installation.previous?.manifest.version,
      error: this.invalid.get(installation.id),
    }
  }
  /** 按安装身份读取当前包的图标，独立安装和移除市场后仍可展示。 */
  async icon(id: string, dark = false, composer = false) {
    await this.ready
    this.assertOpen()
    const installation = (await this.store.read()).installations.find(
      (item) => item.id === id,
    )
    if (installation && !this.invalid.has(id)) {
      const root = this.releasePath(id, installation.current.hash)
      const metadata = await externalMetadata(
        root,
        installation.current.manifest.format,
      ).catch(() => undefined)
      const candidates = [
        ...(dark
          ? [
              composer ? metadata?.composerIconDarkPath : undefined,
              metadata?.logoDarkPath,
            ]
          : []),
        ...(composer ? [metadata?.composerIconPath] : []),
        metadata?.logoPath,
      ]
      for (const declared of new Set(candidates.filter(Boolean))) {
        const image = await readPluginIcon(root, declared)
        if (image)
          return {
            ...image,
            etag: `"${createHash('sha256').update(image.bytes).digest('hex')}"`,
          }
      }
    }
    throw new PluginError(
      PLUGIN_ERROR_CODE.NOT_FOUND,
      '插件未提供可用图标。',
      404,
    )
  }

  async list() {
    await this.ready
    this.assertOpen()
    const state = await this.store.read()
    return {
      revision: state.revision,
      installations: state.installations.map((installation) =>
        this.info(installation),
      ),
    }
  }

  /** 提及时只校验选中的完整包，避免为安装列表热路径重复散列全部插件。 */
  async selectForRun(ids: readonly string[]) {
    await this.ready
    this.assertOpen()
    const state = await this.store.read()
    return Promise.all(
      ids.map(async (id) => {
        const installation = state.installations.find((item) => item.id === id)
        if (!installation) return undefined
        try {
          await this.verify(installation)
          this.invalid.delete(id)
        } catch {
          this.invalid.set(
            id,
            '插件内容缺失或已被修改，已停止加载；请恢复原文件或卸载后重新安装。',
          )
        }
        return this.info(installation)
      }),
    )
  }

  /** 市场条目与直接 Git 来源共用暂存、校验和提交闭环。 */
  async prepare(entryId: string) {
    return this.prepareSource({ entryId })
  }
  async prepareDirect(input: unknown) {
    const value = objectFields(input, ['url', 'ref', 'path'])
    const rawUrl = textField(value.url, 2000)
    const normalized = normalizeGitSource(rawUrl, this.options.allowedGitHosts)
    const ref =
      value.ref === undefined || value.ref === ''
        ? (normalized.ref ?? '')
        : textField(value.ref, 200)
    const rawPath =
      value.path === undefined || value.path === ''
        ? (normalized.path ?? '.')
        : textField(value.path, 500)
    const path = posix.normalize(relativePath(rawPath))
    if (path === '..' || path.startsWith('../'))
      throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件目录不能超出仓库。')
    return this.prepareSource({
      direct: { url: normalized.url, ref, path },
    })
  }
  private async prepareSource(
    input: { entryId: string } | { direct: DirectPluginSource },
  ) {
    await this.ready
    this.assertOpen()
    if (this.jobs.size >= 20)
      throw new PluginError(
        PLUGIN_ERROR_CODE.LIMIT,
        '待处理安装过多，请先取消现有操作。',
        429,
      )
    const direct = 'direct' in input ? input.direct : undefined
    const entry =
      'entryId' in input ? await this.catalog.get(input.entryId) : undefined
    if (entry?.source.kind === PLUGIN_SOURCE_KIND.UNSUPPORTED)
      throw new PluginError(
        PLUGIN_ERROR_CODE.INVALID,
        entry.source.reason ?? '此插件来源暂不支持。',
      )
    const source =
      'entryId' in input
        ? ({
            kind: PLUGIN_INSTALLATION_SOURCE_KIND.MARKET,
          } as const)
        : ({
            kind: PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT,
            ...direct!,
          } as const)
    const key =
      'entryId' in input ? input.entryId : sourceIdentity(input.direct)
    const state = await this.store.read()
    const installed = state.installations.find((item) => item.entryId === key)
    this.assertOpen()
    if (this.jobs.size >= 20)
      throw new PluginError(
        PLUGIN_ERROR_CODE.LIMIT,
        '待处理安装过多，请先取消现有操作。',
        429,
      )
    const id = randomUUID()
    const job: Job = {
      value: {
        id,
        status: PLUGIN_OPERATION_STATUS.FETCHING,
        source,
        ...(entry ? { entry } : {}),
        previousVersion: installed?.current.manifest.version,
      },
      key,
      controller: new AbortController(),
      directory: join(this.directory, 'staging', id),
      revision: installed?.revision ?? 0,
      work: Promise.resolve(),
      timer: setTimeout(() => {
        void this.cancel(id).catch(() => undefined)
      }, 30 * 60_000),
    }
    job.timer.unref()
    this.jobs.set(id, job)
    job.work = (async () => {
      try {
        await privateDirectory(job.directory)
        const content = join(job.directory, 'content')
        if (entry?.source.kind === PLUGIN_SOURCE_KIND.BUNDLED) {
          const root = await resolveContentPath(
            this.catalog.root,
            entry.source.path,
          )
          if ((await inspectTree(root)) !== entry.source.hash)
            throw new PluginError(
              PLUGIN_ERROR_CODE.CONTENT_CHANGED,
              '市场内容已变化，请刷新目录。',
              409,
            )
          await cp(root, content, {
            recursive: true,
            force: false,
            errorOnExist: true,
          })
        } else if (entry) {
          const clone = join(job.directory, 'repository')
          const commit = await fetchGit(
            {
              url: entry.source.url!,
              ref: entry.source.commit ?? entry.source.ref,
            },
            clone,
            job.controller.signal,
            this.options.allowedGitHosts,
          )
          if (entry.source.commit && commit !== entry.source.commit)
            throw new PluginError(
              PLUGIN_ERROR_CODE.CONTENT_CHANGED,
              '下载版本与市场记录不一致。',
              409,
            )
          const root = await resolveContentPath(clone, entry.source.path)
          await cp(root, content, {
            recursive: true,
            force: false,
            errorOnExist: true,
            filter: (path) => basename(path) !== '.git',
          })
        } else if (source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT) {
          const clone = join(job.directory, 'repository')
          const commit = await this.fetchDirect(
            source as DirectPluginSource,
            clone,
            job.controller.signal,
          )
          const root = await resolveContentPath(clone, source.path)
          await cp(root, content, {
            recursive: true,
            force: false,
            errorOnExist: true,
            filter: (path) => basename(path) !== '.git',
          })
          job.value.source = { ...source, commit }
        }
        job.controller.signal.throwIfAborted()
        job.hash = await inspectTree(content)
        if (entry?.source.hash && job.hash !== entry.source.hash)
          throw new PluginError(
            PLUGIN_ERROR_CODE.CONTENT_CHANGED,
            '插件内容校验失败。',
            409,
          )
        const parsed = await inspectManifest(
          content,
          entry?.format,
          job.hash,
          entry?.version,
        )
        if (
          entry &&
          (parsed.manifest.name !== entry.name ||
            (entry.version !== undefined &&
              parsed.manifest.version !== entry.version))
        )
          throw new PluginError(
            PLUGIN_ERROR_CODE.INVALID,
            '插件名称或版本与市场目录不一致。',
          )
        if (
          installed?.current.manifest.version === parsed.manifest.version &&
          installed.current.hash !== job.hash
        )
          throw new PluginError(
            PLUGIN_ERROR_CODE.CONFLICT,
            '同一版本的内容发生变化，请发布新的版本号。',
            409,
          )
        job.controller.signal.throwIfAborted()
        let resolvedEntry = entry
        if (!resolvedEntry) {
          if (source.kind !== PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT)
            throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件来源无效。')
          resolvedEntry = {
            id: key,
            name: parsed.manifest.name,
            displayName: parsed.manifest.displayName,
            description: parsed.manifest.description,
            category: '直接安装',
            version: parsed.manifest.version,
            format: parsed.manifest.format,
            market: '',
            source: {
              kind: PLUGIN_SOURCE_KIND.GIT,
              url: source.url,
              path: source.path,
              commit:
                job.value.source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
                  ? job.value.source.commit
                  : undefined,
            },
          } satisfies PluginCatalogEntry
        } else if (!resolvedEntry.version)
          resolvedEntry = { ...resolvedEntry, version: parsed.manifest.version }
        job.value = {
          ...job.value,
          entry: resolvedEntry,
          ...parsed,
          resetConfiguration:
            !!installed &&
            !sameConfiguration(installed.current.manifest, parsed.manifest),
          status: PLUGIN_OPERATION_STATUS.READY,
        }
      } catch (error) {
        job.value.status = job.controller.signal.aborted
          ? PLUGIN_OPERATION_STATUS.CANCELLED
          : PLUGIN_OPERATION_STATUS.FAILED
        job.value.error =
          error instanceof SourceError || error instanceof PluginError
            ? error.message
            : '插件获取或校验失败，请检查目录、网络和文件。'
        await rm(job.directory, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }
    })()
    return structuredClone(job.value)
  }
  private fetchDirect(
    source: DirectPluginSource,
    destination: string,
    signal: AbortSignal,
  ) {
    return fetchGit(
      { url: source.url, ...(source.ref ? { ref: source.ref } : {}) },
      destination,
      signal,
      this.options.allowedGitHosts,
    )
  }
  operation(id: string) {
    const job = this.jobs.get(id)
    if (!job)
      throw new PluginError(
        PLUGIN_ERROR_CODE.NOT_FOUND,
        '安装操作已过期，请重新准备。',
        404,
      )
    return structuredClone(job.value)
  }

  /** 提交完整版本；修订冲突和本地内容变化均在覆盖前拒绝。 */
  commit(id: string) {
    return this.store.serialize(async () => {
      await this.ready
      this.assertOpen()
      const job = this.jobs.get(id)
      if (!job)
        throw new PluginError(
          PLUGIN_ERROR_CODE.NOT_FOUND,
          '安装操作已过期。',
          404,
        )
      const state = await this.store.read()
      const previous = state.installations.find(
        (item) => item.entryId === job.key,
      )
      if (
        job.value.status === PLUGIN_OPERATION_STATUS.COMMITTED &&
        previous &&
        previous.id === job.value.installationId
      )
        return this.info(previous)
      if (
        job.value.status !== PLUGIN_OPERATION_STATUS.READY ||
        !job.hash ||
        !job.value.manifest ||
        !job.value.skills ||
        (job.value.source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT &&
          !job.value.source.commit)
      )
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '插件尚未准备完成。')
      this.checkRevision(previous?.revision ?? 0, job.revision)
      if (previous) await this.verify(previous)
      if (previous?.current.hash === job.hash) {
        job.value.status = PLUGIN_OPERATION_STATUS.COMMITTED
        job.value.installationId = previous.id
        return this.info(previous)
      }
      if (!previous && state.installations.length >= 100)
        throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, '最多安装 100 个插件。')
      const installationId = previous?.id ?? randomUUID()
      const root = join(this.directory, 'packages', installationId)
      await privateDirectory(root)
      const content = join(job.directory, 'content')
      await this.secureTree(content)
      if ((await inspectTree(content)) !== job.hash)
        throw new PluginError(
          PLUGIN_ERROR_CODE.CONTENT_CHANGED,
          '预览后的内容发生变化，请重新准备。',
          409,
        )
      job.controller.signal.throwIfAborted()
      const destination = this.releasePath(installationId, job.hash)
      let existing = false
      try {
        await lstat(destination)
        if ((await inspectTree(destination)) !== job.hash)
          throw new PluginError(
            PLUGIN_ERROR_CODE.CONTENT_CHANGED,
            '已有版本目录内容不一致，保留本地文件。',
            409,
          )
        existing = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const reset = !!job.value.resetConfiguration
      const serverIds = { ...previous?.serverIds }
      for (const key of Object.keys(job.value.manifest.mcpServers))
        serverIds[key] ??= randomUUID()
      const installation: PluginInstallation = {
        id: installationId,
        entryId: job.key,
        normalizationVersion: 2,
        source: job.value.source as PluginInstallationSource,
        revision: (previous?.revision ?? 0) + 1,
        enabled: !!previous?.enabled && !reset,
        // 每次包内容变化都必须重新授权当前 hash 的命令 Hooks。
        serverIds,
        current: {
          hash: job.hash,
          manifest: job.value.manifest,
          skills: job.value.skills,
          values: reset ? {} : { ...previous?.current.values },
        },
        previous: previous?.current,
      }
      if (!existing) await rename(content, destination)
      try {
        await this.store.write({
          ...state,
          revision: state.revision + 1,
          installations: [
            ...state.installations.filter((item) => item.id !== installationId),
            installation,
          ],
        })
      } catch (error) {
        if (!existing) await rename(destination, content).catch(() => undefined)
        throw error
      }
      this.invalid.delete(installationId)
      job.value.status = PLUGIN_OPERATION_STATUS.COMMITTED
      job.value.installationId = installationId
      await rm(job.directory, { recursive: true, force: true }).catch(
        () => undefined,
      )
      return this.info(installation)
    })
  }

  /** 保存明确输入；省略保留、null 清除，启用之前校验全部必填配置。 */
  update(id: string, revision: number, input: unknown) {
    return this.change(id, revision, async (installation) => {
      await this.verify(installation)
      const patch = objectFields(input, ['enabled', 'values'])
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean')
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, '启用状态无效。')
      const values = objectFields(
        patch.values ?? {},
        installation.current.manifest.inputs.map((item) => item.key),
      )
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete installation.current.values[key]
        else installation.current.values[key] = value as string
      }
      installation.current.values = inputValues(
        installation.current.values,
        installation.current.manifest,
      )
      installation.enabled =
        (patch.enabled as boolean | undefined) ?? installation.enabled
      if (!installation.enabled) installation.trustedHookHash = undefined
      if (installation.enabled && missingInputs(installation.current).length)
        throw new PluginError(
          PLUGIN_ERROR_CODE.CONFIG_REQUIRED,
          '请先填写插件所需的配置。',
        )
      configuredServers(
        installation.current.manifest,
        installation.current.values,
        installation.enabled,
      )
      this.invalid.delete(id)
      return installation
    })
  }
  rollback(id: string, revision: number) {
    return this.change(id, revision, async (installation) => {
      if (!installation.previous)
        throw new PluginError(
          PLUGIN_ERROR_CODE.NOT_FOUND,
          '没有可回退版本。',
          404,
        )
      await this.verify(installation)
      await this.verify(installation, installation.previous)
      const previous = installation.previous
      installation.previous = installation.current
      installation.current = previous
      // 回退也可能改变连接目标；先停用，由用户审阅旧配置后重新启用。
      installation.enabled = false
      installation.trustedHookHash = undefined
      this.invalid.delete(id)
      return installation
    })
  }
  /** Hooks 的命令与包内容在安装详情页审阅后，才信任当前版本的 hash。 */
  trustHooks(id: string, revision: number, trusted: boolean) {
    return this.change(id, revision, async (installation) => {
      if (typeof trusted !== 'boolean')
        throw new PluginError(PLUGIN_ERROR_CODE.INVALID, 'Hook 信任状态无效。')
      await this.verify(installation)
      if (
        trusted &&
        (!installation.enabled || !installation.current.manifest.hooks.length)
      )
        throw new PluginError(
          PLUGIN_ERROR_CODE.INVALID,
          '请先启用包含命令 Hook 的插件。',
        )
      installation.trustedHookHash = trusted
        ? installation.current.hash
        : undefined
      return installation
    })
  }
  /** 只运行已启用、已验证且信任精确包 hash 的命令 Hook。 */
  async runHooks(
    event: 'SessionStart' | 'UserPromptSubmit',
    sessionId: string,
    cwd: string,
    prompt: string,
    signal: AbortSignal,
    sessionSource: 'startup' | 'resume' = 'startup',
  ) {
    await this.ready
    this.assertOpen()
    const state = await this.store.read()
    const contexts: { plugin: string; content: string }[] = []
    const errors: string[] = []
    for (const installation of state.installations) {
      if (signal.aborted) break
      const { current } = installation
      if (
        !installation.enabled ||
        installation.trustedHookHash !== current.hash ||
        this.invalid.has(installation.id)
      )
        continue
      const hooks = current.manifest.hooks.filter(
        (hook) =>
          hook.event === event &&
          (event !== 'SessionStart' ||
            !hook.matcher ||
            hook.matcher.split('|').includes(sessionSource)),
      )
      if (!hooks.length) continue
      try {
        const root = this.releasePath(installation.id, current.hash)
        if ((await inspectTree(root)) !== current.hash) {
          this.invalid.set(
            installation.id,
            '插件内容已变化，已停止加载；请恢复原文件或重新安装。',
          )
          throw new Error('包内容已变化')
        }
        const data = join(this.directory, 'data', installation.id)
        await privateDirectory(data)
        for (const hook of hooks) {
          const content = await runPluginHook(
            hook,
            root,
            data,
            cwd,
            {
              hook_event_name: event,
              session_id: sessionId,
              cwd,
              prompt,
              source: sessionSource,
            },
            signal,
          )
          if (content)
            contexts.push({ plugin: current.manifest.displayName, content })
        }
      } catch {
        errors.push(`${current.manifest.displayName} 的 ${event} Hook 执行失败`)
      }
    }
    return { contexts, errors }
  }
  async remove(id: string, revision: number) {
    await this.change(id, revision, async () => {
      return undefined
    })
    this.invalid.delete(id)
    // 已取消注册的安装独占目录；失败保留文件，不把持久化成功伪装成失败。
    const root = join(this.directory, 'packages', id)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    await rm(join(this.directory, 'data', id), {
      recursive: true,
      force: true,
    }).catch(() => undefined)
  }
  private change(
    id: string,
    revision: number,
    modify: (
      installation: PluginInstallation,
    ) => Promise<PluginInstallation | undefined>,
  ) {
    return this.store.serialize(async () => {
      await this.ready
      this.assertOpen()
      const state = await this.store.read()
      const installation = state.installations.find((item) => item.id === id)
      if (!installation)
        throw new PluginError(PLUGIN_ERROR_CODE.NOT_FOUND, '插件未安装。', 404)
      this.checkRevision(installation.revision, revision)
      const next = await modify(installation)
      if (next) next.revision += 1
      await this.store.write({
        ...state,
        revision: state.revision + 1,
        installations: state.installations.flatMap((item) =>
          item.id === id ? (next ? [next] : []) : [item],
        ),
      })
      return next ? this.info(next) : undefined
    })
  }
  private checkRevision(actual: number, expected: number) {
    if (!Number.isSafeInteger(expected) || actual !== expected)
      throw new PluginError(
        PLUGIN_ERROR_CODE.CONFLICT,
        '插件已被修改，请刷新后重新操作。',
        409,
      )
  }
  private async secureTree(directory: string) {
    await chmod(directory, 0o700)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await this.secureTree(path)
      else if (entry.isFile()) await chmod(path, 0o600)
      else
        throw new PluginError(
          PLUGIN_ERROR_CODE.INVALID,
          '插件内容包含链接或特殊文件。',
        )
    }
  }

  /** 仅输出当前有效版本的能力，供服务端装配；不能直接作为 HTTP 响应。 */
  async capabilities() {
    await this.ready
    this.assertOpen()
    const state = await this.store.read()
    const skills: PluginSkillRoot[] = []
    const servers = []
    for (const installation of state.installations) {
      if (this.invalid.has(installation.id)) continue
      const { current } = installation
      if (installation.enabled)
        for (const skill of current.skills)
          skills.push({
            ...skill,
            id: `plugin-skill:${installation.id}:${skill.name}`,
            pluginId: installation.id,
            pluginName: current.manifest.displayName,
            rootDirectory: await resolveContentPath(
              this.releasePath(installation.id, current.hash),
              skill.path,
            ),
          })
      for (const [key, config] of Object.entries(
        configuredServers(
          current.manifest,
          current.values,
          installation.enabled,
        ),
      )) {
        if (!config.url) {
          const root = this.releasePath(installation.id, current.hash)
          config.cwd = await resolveContentPath(root, config.cwd ?? '.')
          if (config.command?.startsWith('./')) {
            config.command = await resolveContentPath(root, config.command)
            await chmod(config.command, 0o700)
          }
        }
        servers.push({
          config: {
            ...config,
            id: installation.serverIds[key],
            revision: installation.revision,
            name: key,
          },
          owner: { id: installation.id, name: current.manifest.displayName },
        })
      }
    }
    return { skills, servers }
  }
  async cancel(id: string) {
    const job = this.jobs.get(id)
    if (!job) return
    clearTimeout(job.timer)
    job.controller.abort()
    await job.work
    await this.store.settled()
    await rm(job.directory, { recursive: true, force: true })
    this.jobs.delete(id)
  }
  async close() {
    this.closed = true
    await this.catalog.close()
    await Promise.allSettled([...this.jobs.keys()].map((id) => this.cancel(id)))
    await this.ready.catch(() => undefined)
    await this.store.settled()
  }
}
