import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  PLUGIN_ERROR_CODE,
  PLUGIN_INSTALLATION_SOURCE_KIND,
} from '@oh-my-harness/shared'
import { PluginError } from '../error.ts'
import {
  objectFields,
  parseManifest,
  type PluginManifest,
  type PluginSkill,
} from '../manifest/manifest.ts'

export interface PluginRelease {
  hash: string
  manifest: PluginManifest
  skills: PluginSkill[]
  values: Record<string, string>
}
export type PluginInstallationSource =
  | { kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
  | {
      kind: typeof PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT
      url: string
      ref: string
      path: string
      commit: string
    }
export interface PluginInstallation {
  normalizationVersion?: 2
  id: string
  entryId: string
  source: PluginInstallationSource
  revision: number
  enabled: boolean
  trustedHookHash?: string
  current: PluginRelease
  previous?: PluginRelease
  serverIds: Record<string, string>
}
export interface PluginState {
  schemaVersion: 3
  revision: number
  installations: PluginInstallation[]
}
export const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
export const HASH_PATTERN = /^[a-f0-9]{64}$/u
const MAX_STATE_BYTES = 8 * 1024 * 1024

/** 数据目录不能是链接；状态和内容只由当前系统用户访问。 */
export const privateDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new PluginError(PLUGIN_ERROR_CODE.CORRUPT, '插件数据目录无效。', 500)
  await chmod(directory, 0o700)
}

/** 完整写入并同步临时文件后原子发布，失败时不覆盖已有文档。 */
export const atomicJson = async (
  directory: string,
  name: string,
  value: unknown,
) => {
  const source = JSON.stringify(value)
  if (Buffer.byteLength(source) > MAX_STATE_BYTES)
    throw new PluginError(PLUGIN_ERROR_CODE.LIMIT, '插件数据超过存储限制。')
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(source)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, join(directory, name))
  } finally {
    await rm(temporary, { force: true })
  }
}

/** 有限读取 JSON；未知文件错误必须保留并上报。 */
export const readJson = async (path: string): Promise<unknown> => {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES)
    throw new PluginError(PLUGIN_ERROR_CODE.CORRUPT, '插件数据文件无效。', 500)
  return JSON.parse(await readFile(path, 'utf8'))
}

/** 校验用户输入值，不允许隐式新增字段或将非法值写入凭据。 */
export const inputValues = (
  value: unknown,
  manifest: PluginManifest,
): Record<string, string> => {
  const record = objectFields(
    value,
    manifest.inputs.map((input) => input.key),
  )
  if (
    Object.values(record).some(
      (value) =>
        typeof value !== 'string' ||
        value.length > 16384 ||
        /[\r\n\0]/u.test(value),
    )
  )
    throw new PluginError(
      PLUGIN_ERROR_CODE.INVALID,
      '配置值必须为不含换行的有限文本。',
    )
  return record as Record<string, string>
}
const release = (value: unknown): PluginRelease => {
  const row = objectFields(value, ['hash', 'manifest', 'skills', 'values'])
  if (typeof row.hash !== 'string' || !HASH_PATTERN.test(row.hash))
    throw new Error('invalid hash')
  const manifest = parseManifest(row.manifest)
  if (
    !Array.isArray(row.skills) ||
    row.skills.length !== manifest.skills.length
  )
    throw new Error('invalid skills')
  const names = new Set<string>()
  for (const skill of row.skills) {
    const item = objectFields(skill, ['name', 'description', 'path'])
    if (
      typeof item.name !== 'string' ||
      !/^[a-z0-9-]{1,64}$/u.test(item.name) ||
      names.has(item.name) ||
      typeof item.description !== 'string' ||
      item.description.length > 1024 ||
      !manifest.skills.includes(item.path as string)
    )
      throw new Error('invalid skill')
    names.add(item.name)
  }
  return {
    hash: row.hash,
    manifest,
    skills: row.skills as PluginSkill[],
    values: inputValues(row.values, manifest),
  }
}
const installationSource = (value: unknown): PluginInstallationSource => {
  const source = objectFields(value, ['kind', 'url', 'ref', 'path', 'commit'])
  if (source.kind === PLUGIN_INSTALLATION_SOURCE_KIND.MARKET) {
    if (Object.keys(source).length !== 1)
      throw new Error('invalid market source')
    return { kind: PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
  }
  if (
    source.kind !== PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT ||
    typeof source.url !== 'string' ||
    source.url.length > 2000 ||
    typeof source.ref !== 'string' ||
    source.ref.length > 200 ||
    typeof source.path !== 'string' ||
    source.path.length > 500 ||
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(source.commit)
  )
    throw new Error('invalid direct source')
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    throw new Error('invalid direct source URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    /[\r\n\0]/u.test(source.ref) ||
    !source.path ||
    source.path.includes('\\') ||
    source.path.includes('\0') ||
    source.path === '..' ||
    source.path.startsWith('../') ||
    source.path.startsWith('/')
  )
    throw new Error('invalid direct source')
  return {
    kind: PLUGIN_INSTALLATION_SOURCE_KIND.DIRECT,
    url: url.href,
    ref: source.ref,
    path: source.path,
    commit: source.commit,
  }
}

/** 单一插件状态事实源；写入完成才替换内存，损坏文件绝不重置。 */
export class PluginStore {
  private state?: PluginState
  private loading?: Promise<PluginState>
  // ponytail: 本地低频变更串行；多进程共享数据目录时再增加进程锁。
  private pending: Promise<unknown> = Promise.resolve()
  readonly directory: string
  constructor(directory: string) {
    this.directory = directory
  }

  async read(): Promise<PluginState> {
    if (this.state) return structuredClone(this.state)
    this.loading ??= this.load().finally(() => {
      this.loading = undefined
    })
    return structuredClone(await this.loading)
  }
  private async load() {
    await privateDirectory(this.directory)
    try {
      const row = objectFields(
        await readJson(join(this.directory, 'state.json')),
        ['schemaVersion', 'revision', 'installations'],
      )
      if (
        ![1, 2, 3].includes(row.schemaVersion as number) ||
        !Number.isSafeInteger(row.revision) ||
        (row.revision as number) < 0 ||
        !Array.isArray(row.installations) ||
        row.installations.length > 100
      )
        throw new Error('invalid state')
      const legacy = row.schemaVersion === 1
      const ids = new Set<string>(),
        entries = new Set<string>(),
        servers = new Set<string>()
      const installations = row.installations.map(
        (value): PluginInstallation => {
          const item = objectFields(value, [
            'id',
            'normalizationVersion',
            'entryId',
            'source',
            'revision',
            'enabled',
            'trustedHookHash',
            'current',
            'previous',
            'serverIds',
          ])
          if (
            typeof item.id !== 'string' ||
            !UUID_PATTERN.test(item.id) ||
            ids.has(item.id) ||
            typeof item.entryId !== 'string' ||
            !HASH_PATTERN.test(item.entryId) ||
            entries.has(item.entryId) ||
            !Number.isSafeInteger(item.revision) ||
            (item.revision as number) < 1 ||
            typeof item.enabled !== 'boolean'
          )
            throw new Error('invalid installation')
          ids.add(item.id)
          entries.add(item.entryId)
          const current = release(item.current),
            previous =
              item.previous === undefined ? undefined : release(item.previous)
          const source: PluginInstallationSource =
            legacy && item.source === undefined
              ? { kind: PLUGIN_INSTALLATION_SOURCE_KIND.MARKET }
              : installationSource(item.source)
          const serverIds = objectFields(item.serverIds)
          for (const [key, id] of Object.entries(serverIds)) {
            if (
              !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(key) ||
              typeof id !== 'string' ||
              !UUID_PATTERN.test(id) ||
              servers.has(id)
            )
              throw new Error('invalid server id')
            servers.add(id)
          }
          if (
            Object.keys(current.manifest.mcpServers).some(
              (key) => !serverIds[key],
            )
          )
            throw new Error('missing server id')
          if (
            item.trustedHookHash !== undefined &&
            (typeof item.trustedHookHash !== 'string' ||
              !HASH_PATTERN.test(item.trustedHookHash) ||
              item.trustedHookHash !== current.hash ||
              !item.enabled ||
              !current.manifest.hooks.length)
          )
            throw new Error('invalid hook trust')
          return {
            ...(item.normalizationVersion === 2
              ? { normalizationVersion: 2 as const }
              : {}),
            id: item.id,
            entryId: item.entryId,
            source,
            revision: item.revision as number,
            enabled: item.enabled,
            ...(item.trustedHookHash === undefined
              ? {}
              : { trustedHookHash: item.trustedHookHash as string }),
            current,
            previous,
            serverIds: serverIds as Record<string, string>,
          }
        },
      )
      const state: PluginState = {
        schemaVersion: 3,
        revision: row.revision as number,
        installations,
      }
      if (row.schemaVersion !== 3)
        await atomicJson(this.directory, 'state.json', state)
      this.state = state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        this.state = { schemaVersion: 3, revision: 0, installations: [] }
      else
        throw new PluginError(
          PLUGIN_ERROR_CODE.CORRUPT,
          '插件状态无法读取，已保留原文件。',
          500,
        )
    }
    return this.state
  }
  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => undefined)
    return result
  }
  async write(state: PluginState) {
    await atomicJson(this.directory, 'state.json', state)
    this.state = structuredClone(state)
  }
  async settled() {
    await this.pending
  }
}
