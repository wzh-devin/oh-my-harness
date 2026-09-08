import {
  SESSION_CUSTOM_TYPE,
  type AgentSessionInfo,
  type AgentSessionProjection,
} from '@oh-my-harness/agent-runtime'
import {
  JsonlSessionRepo,
  type JsonlSessionMetadata,
} from '@earendil-works/pi-agent-core'
import { chmod, lstat, open, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

const APPLICATION_ID = 0x44564149 // DVAI
const SCHEMA_VERSION = 2
const DATABASE_NAME = 'session-index.sqlite'
const COLUMNS = [
  'id',
  'rollout_path',
  'cwd',
  'created_at',
  'updated_at',
  'name',
  'provider_id',
  'model_id',
  'archived',
  'source_size',
  'source_mtime_ms',
  'next_byte_offset',
  'last_seq',
]

interface SessionIndexRow {
  archived: boolean
  createdAt: number
  cwd: string
  id: string
  lastSeq: number
  modelId: string
  name: string | null
  nextByteOffset: number
  providerId: string
  rolloutPath: string
  sourceMtimeMs: number
  sourceSize: number
  updatedAt: number
}

interface FileRevision {
  mtimeMs: number
  size: number
}

class UnknownSessionIndexError extends Error {}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function metadataConfig(metadata: JsonlSessionMetadata) {
  const value = metadata.metadata
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.providerId !== 'string' ||
    typeof value.modelId !== 'string'
  ) {
    throw new Error('Session metadata is invalid')
  }
  return { modelId: value.modelId, providerId: value.providerId }
}

function mutationTimestamp(value: Record<string, unknown>) {
  return Number.isSafeInteger(value.timestamp) && Number(value.timestamp) >= 0
    ? Number(value.timestamp)
    : undefined
}

function archiveDataState(data: unknown) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    typeof (data as Record<string, unknown>).archived !== 'boolean'
  ) {
    throw new Error('Session archive entry is invalid')
  }
  return (data as { archived: boolean }).archived
}

function indexInfo(row: SessionIndexRow): AgentSessionInfo {
  return {
    archived: row.archived,
    createdAt: row.createdAt,
    cwd: row.cwd,
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    providerId: row.providerId,
  }
}

function decodeRow(value: Record<string, unknown>): SessionIndexRow {
  const row = value as Record<string, number | string | null>
  if (
    typeof row.id !== 'string' ||
    typeof row.rollout_path !== 'string' ||
    typeof row.cwd !== 'string' ||
    typeof row.created_at !== 'number' ||
    typeof row.updated_at !== 'number' ||
    (row.name !== null && typeof row.name !== 'string') ||
    typeof row.provider_id !== 'string' ||
    typeof row.model_id !== 'string' ||
    (row.archived !== 0 && row.archived !== 1) ||
    typeof row.source_size !== 'number' ||
    typeof row.source_mtime_ms !== 'number' ||
    typeof row.next_byte_offset !== 'number' ||
    typeof row.last_seq !== 'number'
  ) {
    throw new Error('Session index row is invalid')
  }
  return {
    archived: row.archived === 1,
    createdAt: row.created_at,
    cwd: row.cwd,
    id: row.id,
    lastSeq: row.last_seq,
    modelId: row.model_id,
    name: row.name,
    nextByteOffset: row.next_byte_offset,
    providerId: row.provider_id,
    rolloutPath: row.rollout_path,
    sourceMtimeMs: row.source_mtime_ms,
    sourceSize: row.source_size,
    updatedAt: row.updated_at,
  }
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    BEGIN IMMEDIATE;
    CREATE TABLE sessions (
      id                  TEXT PRIMARY KEY,
      rollout_path        TEXT NOT NULL UNIQUE,
      cwd                 TEXT NOT NULL,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      name                TEXT,
      provider_id         TEXT NOT NULL,
      model_id            TEXT NOT NULL,
      archived            INTEGER NOT NULL CHECK (archived IN (0, 1)),
      source_size         INTEGER NOT NULL,
      source_mtime_ms     INTEGER NOT NULL,
      next_byte_offset    INTEGER NOT NULL,
      last_seq            INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX sessions_updated_at
      ON sessions(updated_at DESC, id DESC);
    CREATE INDEX sessions_cwd_updated_at
      ON sessions(cwd, updated_at DESC, id DESC);
    PRAGMA application_id = ${APPLICATION_ID};
    PRAGMA user_version = ${SCHEMA_VERSION};
    COMMIT;
  `)
}

function validateSchema(database: DatabaseSync) {
  const applicationId = database
    .prepare('PRAGMA application_id')
    .get()?.application_id
  const version = database.prepare('PRAGMA user_version').get()?.user_version
  const columns = database
    .prepare('PRAGMA table_info(sessions)')
    .all()
    .map((column) => column.name)
  const quickCheck = database
    .prepare('PRAGMA quick_check(1)')
    .get()?.quick_check
  if (
    applicationId !== APPLICATION_ID ||
    version !== SCHEMA_VERSION ||
    quickCheck !== 'ok' ||
    columns.length !== COLUMNS.length ||
    columns.some((column, index) => column !== COLUMNS[index])
  ) {
    throw new Error('Session index schema is incompatible')
  }
}

function enableRuntimePragmas(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `)
}

async function databaseApplicationId(path: string) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(72)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (
      bytesRead < header.length ||
      header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
    ) {
      return undefined
    }
    return header.readInt32BE(68)
  } finally {
    await handle.close()
  }
}

/** JSONL 事实日志的可重建 SQLite 会话目录投影。 */
export class SessionIndex implements AgentSessionProjection {
  private database?: DatabaseSync
  private dirty = false
  private listCache: AgentSessionInfo[] = []
  private metadata = new Map<string, JsonlSessionMetadata>()
  private tail = Promise.resolve()
  private closed = false
  private readonly path: string
  private readonly repository: JsonlSessionRepo

  private constructor(path: string, repository: JsonlSessionRepo) {
    this.path = path
    this.repository = repository
  }

  static async create(dataDirectory: string, repository: JsonlSessionRepo) {
    const index = new SessionIndex(
      join(resolve(dataDirectory), DATABASE_NAME),
      repository,
    )
    await index.initialize()
    return index
  }

  async changed(id: string) {
    if (this.closed || !this.database) return
    await this.enqueue(async () => {
      try {
        let metadata = this.metadata.get(id)
        if (!metadata) {
          const listed = await this.repository.list()
          this.metadata = new Map(listed.map((item) => [item.id, item]))
          metadata = this.metadata.get(id)
        }
        if (!metadata) throw new Error('Session metadata is missing')
        this.updateListCache(await this.projectOne(metadata))
      } catch {
        this.dirty = true
      }
    })
  }

  async deleted(id: string) {
    if (this.closed || !this.database) return
    await this.enqueue(async () => {
      try {
        this.requireDatabase()
          .prepare('DELETE FROM sessions WHERE id = ?')
          .run(id)
        this.listCache = this.listCache.filter((session) => session.id !== id)
        this.metadata.delete(id)
      } catch {
        this.dirty = true
      }
    })
  }

  async list() {
    if (this.closed || !this.database) {
      throw new Error('Session index is unavailable')
    }
    if (!this.dirty) return this.listCache
    await this.tail
    await this.enqueue(async () => {
      if (this.dirty) await this.reconcile()
    })
    return this.listCache
  }

  async close() {
    if (this.closed) return
    this.closed = true
    await this.tail
    this.database?.close()
    this.database = undefined
  }

  private async initialize() {
    try {
      this.database = await this.openDatabase()
    } catch {
      console.warn('Session index unavailable; using JSONL fallback.')
      return
    }
    try {
      await this.reconcile()
    } catch {
      this.dirty = true
      console.warn('Session index degraded; using JSONL fallback.')
    }
  }

  private async openDatabase() {
    let exists = true
    try {
      const info = await lstat(this.path)
      if (!info.isFile()) throw new UnknownSessionIndexError()
    } catch (error) {
      if (!isMissing(error)) throw error
      exists = false
    }

    if (!exists) {
      const database = new DatabaseSync(this.path)
      try {
        createSchema(database)
        enableRuntimePragmas(database)
        await this.secureFiles()
        return database
      } catch (error) {
        database.close()
        throw error
      }
    }

    if ((await databaseApplicationId(this.path)) !== APPLICATION_ID) {
      throw new UnknownSessionIndexError()
    }

    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.path)
      validateSchema(database)
      enableRuntimePragmas(database)
      await this.secureFiles()
      return database
    } catch {
      database?.close()
      return this.rebuildDatabase()
    }
  }

  private async rebuildDatabase() {
    const temporaryPath = `${this.path}.rebuild`
    await rm(temporaryPath, { force: true })
    await rm(`${temporaryPath}-wal`, { force: true })
    await rm(`${temporaryPath}-shm`, { force: true })
    const temporary = new SessionIndex(temporaryPath, this.repository)
    temporary.database = new DatabaseSync(temporaryPath)
    try {
      createSchema(temporary.database)
      await temporary.reconcile()
      temporary.database.close()
      temporary.database = undefined
      if (process.platform !== 'win32') await chmod(temporaryPath, 0o600)
      await rm(`${this.path}-wal`, { force: true })
      await rm(`${this.path}-shm`, { force: true })
      await rename(temporaryPath, this.path)
    } catch (error) {
      temporary.database?.close()
      await rm(temporaryPath, { force: true })
      throw error
    }
    const database = new DatabaseSync(this.path)
    try {
      validateSchema(database)
      enableRuntimePragmas(database)
      await this.secureFiles()
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  private async reconcile() {
    const listed = await this.repository.list()
    const metadata = new Map(listed.map((item) => [item.id, item]))
    const rows = new Map(
      this.requireDatabase()
        .prepare('SELECT * FROM sessions')
        .all()
        .map((row) => {
          const decoded = decodeRow(row)
          return [decoded.id, decoded] as const
        }),
    )
    const projections: SessionIndexRow[] = []
    for (const item of metadata.values()) {
      const source = await stat(item.path)
      const previous = rows.get(item.id)
      const sourceMtimeMs = Math.trunc(source.mtimeMs)
      if (
        previous &&
        previous.rolloutPath === item.path &&
        previous.sourceSize === source.size &&
        previous.sourceMtimeMs === sourceMtimeMs
      ) {
        continue
      }
      projections.push(await this.project(item, previous, source))
    }

    const database = this.requireDatabase()
    const upsert = this.upsertStatement(database)
    const remove = database.prepare('DELETE FROM sessions WHERE id = ?')
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const projection of projections) this.upsert(upsert, projection)
      for (const id of rows.keys()) {
        if (!metadata.has(id)) remove.run(id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    this.metadata = metadata
    this.refreshListCache()
    this.dirty = false
    await this.secureFiles()
  }

  private async projectOne(metadata: JsonlSessionMetadata) {
    const source = await stat(metadata.path)
    const current = this.requireDatabase()
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(metadata.id)
    const projection = await this.project(
      metadata,
      current ? decodeRow(current) : undefined,
      source,
    )
    this.upsert(this.upsertStatement(this.requireDatabase()), projection)
    this.metadata.set(metadata.id, {
      ...metadata,
      modifiedAt: projection.sourceMtimeMs,
    })
    return projection
  }

  private async project(
    metadata: JsonlSessionMetadata,
    previous: SessionIndexRow | undefined,
    source: FileRevision,
  ) {
    if (
      previous &&
      previous.rolloutPath === metadata.path &&
      previous.sourceSize === previous.nextByteOffset &&
      source.size > previous.sourceSize
    ) {
      try {
        return await this.incrementalProjection(metadata, previous, source)
      } catch {
        // 游标或追加内容异常时只重建当前 Session 行。
      }
    }
    return this.fullProjection(metadata)
  }

  private async incrementalProjection(
    metadata: JsonlSessionMetadata,
    previous: SessionIndexRow,
    source: FileRevision,
  ) {
    const length = source.size - previous.nextByteOffset
    const buffer = Buffer.alloc(length)
    const handle = await open(metadata.path, 'r')
    try {
      let read = 0
      while (read < length) {
        const result = await handle.read(
          buffer,
          read,
          length - read,
          previous.nextByteOffset + read,
        )
        if (result.bytesRead === 0) throw new Error('Unexpected JSONL EOF')
        read += result.bytesRead
      }
    } finally {
      await handle.close()
    }
    const content = buffer.toString('utf8')
    if (!content.endsWith('\n')) throw new Error('Incomplete JSONL tail')
    const next = { ...previous }
    let hasUntimestampedMutation = false
    for (const line of content.slice(0, -1).split('\n')) {
      if (!line) throw new Error('Unexpected blank JSONL line')
      const value = JSON.parse(line) as Record<string, unknown>
      if (value.seq !== next.lastSeq + 1) {
        throw new Error('JSONL sequence is discontinuous')
      }
      next.lastSeq += 1
      const timestamp = mutationTimestamp(value)
      if (timestamp === undefined) hasUntimestampedMutation = true
      else next.updatedAt = Math.max(next.updatedAt, timestamp)

      if (value.kind === 'fact' && value.fact === 'name') {
        if (value.name !== undefined && typeof value.name !== 'string') {
          throw new Error('Session name fact is invalid')
        }
        next.name = typeof value.name === 'string' ? value.name : null
      } else if (
        value.kind === 'entry' &&
        value.type === 'model_change' &&
        (value.lane === undefined || value.lane === 'main')
      ) {
        if (
          typeof value.provider !== 'string' ||
          typeof value.modelId !== 'string'
        ) {
          throw new Error('Session model change is invalid')
        }
        next.providerId = value.provider
        next.modelId = value.modelId
      } else if (
        value.kind === 'entry' &&
        value.type === 'custom' &&
        value.customType === SESSION_CUSTOM_TYPE.SESSION_ARCHIVE_CHANGED &&
        (value.lane === undefined || value.lane === 'main')
      ) {
        next.archived = archiveDataState(value.data)
      }
    }
    next.sourceSize = source.size
    next.sourceMtimeMs = Math.trunc(source.mtimeMs)
    next.nextByteOffset = source.size
    if (hasUntimestampedMutation) {
      next.updatedAt = Math.max(next.updatedAt, next.sourceMtimeMs)
    }
    return next
  }

  private async fullProjection(metadata: JsonlSessionMetadata) {
    const session = await this.repository.open(metadata)
    const [name, modelChange, archiveEntry, log] = await Promise.all([
      session.getName(),
      session.findEntryOnBranch({
        order: 'newestFirst',
        type: 'model_change',
      }),
      session.findEntryOnBranch({
        customType: SESSION_CUSTOM_TYPE.SESSION_ARCHIVE_CHANGED,
        order: 'newestFirst',
        type: 'custom',
      }),
      session.getLog(),
    ])
    const source = await stat(metadata.path)
    const fallback = metadataConfig(metadata)
    let updatedAt = metadata.createdAt
    let lastSeq = 0
    for (const item of log) {
      lastSeq = Math.max(lastSeq, item.seq)
      if (item.kind === 'entry') {
        updatedAt = Math.max(updatedAt, item.entry.timestamp)
      } else if (item.kind === 'record') {
        updatedAt = Math.max(updatedAt, item.record.timestamp)
      }
    }
    return {
      archived:
        archiveEntry?.type === 'custom'
          ? archiveDataState(archiveEntry.data)
          : false,
      createdAt: metadata.createdAt,
      cwd: metadata.cwd,
      id: metadata.id,
      lastSeq,
      modelId:
        modelChange?.type === 'model_change'
          ? modelChange.modelId
          : fallback.modelId,
      name: name ?? null,
      nextByteOffset: source.size,
      providerId:
        modelChange?.type === 'model_change'
          ? modelChange.provider
          : fallback.providerId,
      rolloutPath: metadata.path,
      sourceMtimeMs: Math.trunc(source.mtimeMs),
      sourceSize: source.size,
      updatedAt: Math.max(updatedAt, Math.trunc(source.mtimeMs)),
    } satisfies SessionIndexRow
  }

  private upsertStatement(database: DatabaseSync) {
    return database.prepare(`
      INSERT INTO sessions (
        id, rollout_path, cwd, created_at, updated_at, name,
        provider_id, model_id, archived, source_size, source_mtime_ms,
        next_byte_offset, last_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rollout_path = excluded.rollout_path,
        cwd = excluded.cwd,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        name = excluded.name,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        archived = excluded.archived,
        source_size = excluded.source_size,
        source_mtime_ms = excluded.source_mtime_ms,
        next_byte_offset = excluded.next_byte_offset,
        last_seq = excluded.last_seq
    `)
  }

  private upsert(statement: StatementSync, row: SessionIndexRow) {
    statement.run(
      row.id,
      row.rolloutPath,
      row.cwd,
      row.createdAt,
      row.updatedAt,
      row.name,
      row.providerId,
      row.modelId,
      row.archived ? 1 : 0,
      row.sourceSize,
      row.sourceMtimeMs,
      row.nextByteOffset,
      row.lastSeq,
    )
  }

  private refreshListCache() {
    const rows = this.requireDatabase()
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC, id DESC')
      .all()
      .map((row) => decodeRow(row))
    this.listCache = rows.map((row) => indexInfo(row))
  }

  private updateListCache(row: SessionIndexRow) {
    const info = indexInfo(row)
    const index = this.listCache.findIndex((session) => session.id === row.id)
    if (index !== -1) this.listCache.splice(index, 1)
    // Runtime 只通知刚完成的本地 mutation；启动时仍以 SQLite 顺序重建缓存。
    this.listCache.unshift(info)
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private requireDatabase() {
    if (!this.database) throw new Error('Session index is unavailable')
    return this.database
  }

  private async secureFiles() {
    if (process.platform === 'win32') return
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try {
        await chmod(path, 0o600)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }
}
