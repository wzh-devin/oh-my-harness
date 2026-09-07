import {
  getToolActivityKind,
  type ToolActivityKind,
} from '../execution/tool-presentation.ts'
import type {
  Entry,
  JsonValue,
  Session,
  SessionCreateOptions,
  SessionMetadata,
  SessionRepo,
  SessionStats,
} from '@earendil-works/pi-agent-core'
import { SessionError } from '@earendil-works/pi-agent-core'
import {
  BUILTIN_TOOL_NAME,
  parseTodoWriteInput,
  type TodoItem,
} from '@oh-my-harness/agent-tools'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'

import { AgentRuntimeError } from '../error/agent-runtime-error.ts'
import { toolFilePath } from '../execution/tool-file-path.ts'
import { structuredMessageDetails } from '../execution/attachment-message.ts'
import { safeBashOutcome } from '../execution/bash-outcome.ts'
import {
  parseContextUsageSnapshot,
  type ContextUsageSnapshot,
} from '../execution/context-usage.ts'
import type {
  AgentMessageAttachment,
  AgentMessageContextItem,
} from '../execution/run-input.ts'
import {
  projectAgentTrajectory,
  type AgentTrajectory,
  type AgentTrajectoryRecord,
} from '../trajectory/agent-trajectory.ts'
import { SESSION_CUSTOM_TYPE } from './session-custom-type.ts'

export interface AgentSessionModelConfig {
  modelId: string
  providerId: string
  schemaVersion: 1
}

export interface AgentSessionMetadata extends SessionMetadata {
  cwd: string
  metadata?: Record<string, JsonValue>
  path: string
}

export interface AgentSessionCreateOptions extends SessionCreateOptions {
  cwd: string
  metadata?: Record<string, JsonValue>
}

export interface AgentSessionListOptions {
  cwd?: string
}

export type AgentSessionRepository = SessionRepo<
  AgentSessionMetadata,
  AgentSessionCreateOptions,
  AgentSessionListOptions
>

export interface AgentSessionInfo {
  archived: boolean
  createdAt: number
  cwd: string
  id: string
  modelId: string
  name: string | null
  providerId: string
}

/** 可失败、可重建的 Session 查询投影；JSONL 仍是唯一事实源。 */
export interface AgentSessionProjection {
  changed(id: string): Promise<void>
  deleted(id: string): Promise<void>
  list(): Promise<AgentSessionInfo[]>
}

export interface AgentSessionDetail extends AgentSessionInfo {
  pluginIds: string[]
  contextUsage?: ContextUsageSnapshot
  stats: SessionStats
}

export interface AgentSessionMessage {
  attachments?: AgentMessageAttachment[]
  content: string
  contextItems?: AgentMessageContextItem[]
  entryId: string
  parts?: AgentSessionMessagePart[]
  reasoning?: string
  role: 'assistant' | 'user'
  seq: number
  stopReason?: string
  timestamp: number
  tools?: AgentSessionTool[]
}

export interface AgentSessionTool {
  errorText?: string
  input: Record<string, unknown>
  kind: ToolActivityKind
  outcome?: import('@oh-my-harness/agent-tools').BashOutcome
  output?: string
  state: 'input-available' | 'output-available' | 'output-error'
  toolCallId: string
  toolName: string
}

export type AgentSessionMessagePart =
  | { reasoning: string; type: 'reasoning' }
  | { text: string; type: 'text' }
  | { tool: AgentSessionTool; type: 'tool' }

export interface AgentSessionMessagePage {
  items: AgentSessionMessage[]
  nextCursor: number | null
  todos?: TodoItem[]
}

export interface OpenAgentSession {
  archived: boolean
  config: AgentSessionModelConfig
  entries: Entry[]
  metadata: AgentSessionMetadata
  session: Session<AgentSessionMetadata>
}

const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readHeaderConfig(
  metadata: AgentSessionMetadata,
): AgentSessionModelConfig {
  const value = metadata.metadata
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.providerId !== 'string' ||
    typeof value.modelId !== 'string'
  ) {
    throw new AgentRuntimeError(
      'SESSION_METADATA_INVALID',
      '会话元数据无效。',
      500,
    )
  }
  return {
    modelId: value.modelId,
    providerId: value.providerId,
    schemaVersion: 1,
  }
}

function configFromModelChange(
  entry: Entry | undefined,
  fallback: AgentSessionModelConfig,
) {
  return entry?.type === 'model_change'
    ? {
        modelId: entry.modelId,
        providerId: entry.provider,
        schemaVersion: 1 as const,
      }
    : fallback
}

function toInfo(
  metadata: AgentSessionMetadata,
  config: AgentSessionModelConfig,
  name: string | undefined,
  archived = false,
): AgentSessionInfo {
  return {
    archived,
    createdAt: metadata.createdAt,
    cwd: metadata.cwd,
    id: metadata.id,
    modelId: config.modelId,
    name: name ?? null,
    providerId: config.providerId,
  }
}

function archiveState(entry: Entry | undefined) {
  if (entry === undefined) return false
  if (
    entry.type !== 'custom' ||
    entry.customType !== SESSION_CUSTOM_TYPE.sessionArchiveChanged ||
    !entry.data ||
    typeof entry.data !== 'object' ||
    Array.isArray(entry.data) ||
    typeof (entry.data as Record<string, unknown>).archived !== 'boolean'
  ) {
    throw new Error('Session archive entry is invalid')
  }
  return (entry.data as { archived: boolean }).archived
}

function messageText(message: AssistantMessage | UserMessage) {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join('')
  }
  return message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('')
}

function toolResultText(message: ToolResultMessage) {
  return message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('')
}

function safeToolInput(input: Record<string, unknown>) {
  const attachmentId =
    typeof input.attachmentId === 'string' ? input.attachmentId : undefined
  if (attachmentId !== undefined) {
    return attachmentId && !attachmentId.includes('\0')
      ? { attachmentId }
      : { attachmentId: '[blocked id]' }
  }
  if (typeof input.command === 'string') {
    return input.command &&
      !input.command.includes('\0') &&
      Buffer.byteLength(input.command) <= 32 * 1024
      ? { command: input.command }
      : { command: '[blocked command]' }
  }
  const path = typeof input.path === 'string' ? input.path : undefined
  if (
    path === undefined ||
    path.includes('\0') ||
    path === '~' ||
    path.startsWith('~/') ||
    path.startsWith('file:')
  ) {
    return path === undefined ? {} : { path: '[blocked path]' }
  }
  return { path }
}

function toSessionTool(
  toolCall: Extract<AssistantMessage['content'][number], { type: 'toolCall' }>,
  toolResults: ReadonlyMap<string, ToolResultMessage>,
): AgentSessionTool {
  const result = toolResults.get(toolCall.id)
  const output = result ? toolResultText(result) : undefined
  const outcome =
    toolCall.name === BUILTIN_TOOL_NAME.bash
      ? safeBashOutcome(result?.details)
      : undefined
  return {
    ...(result?.isError && output ? { errorText: output } : {}),
    input: toolFilePath(result?.details)
      ? { path: toolFilePath(result?.details) }
      : safeToolInput(toolCall.arguments),
    kind: getToolActivityKind(toolCall.name),
    ...(!result?.isError && output ? { output } : {}),
    ...(outcome ? { outcome } : {}),
    state: result
      ? result.isError
        ? 'output-error'
        : 'output-available'
      : 'input-available',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  }
}

const projectTodoState = (entries: readonly Entry[]) => {
  let hasNewerTerminalAssistant = false
  let hasNewerUser = false
  const newestFirst =
    entries.length < 2 || entries[0]!.seq > entries.at(-1)!.seq
  for (
    let index = newestFirst ? 0 : entries.length - 1;
    index >= 0 && index < entries.length;
    index += newestFirst ? 1 : -1
  ) {
    const entry = entries[index]!
    if (entry.type === 'message') {
      if (
        entry.message.role === 'user' ||
        (entry.message.role === 'custom' &&
          entry.message.customType === SESSION_CUSTOM_TYPE.userInput)
      ) {
        hasNewerUser = true
      } else if (
        entry.message.role === 'assistant' &&
        entry.message.stopReason !== 'toolUse'
      ) {
        hasNewerTerminalAssistant = true
      }
      continue
    }
    if (
      entry.type !== 'custom' ||
      entry.customType !== SESSION_CUSTOM_TYPE.todoUpdated ||
      !entry.data ||
      typeof entry.data !== 'object' ||
      Array.isArray(entry.data) ||
      (entry.data as Record<string, unknown>).schemaVersion !== 1
    ) {
      continue
    }
    try {
      const todos = parseTodoWriteInput({
        todos: (entry.data as Record<string, unknown>).todos,
      })
      return { hasNewerTerminalAssistant, hasNewerUser, todos }
    } catch {
      // 未知或损坏的投影事件不影响上一份有效 Todo。
    }
  }
  return undefined
}

/** 投影当前轮可见计划；用户边界或未完成终态会关闭旧计划。 */
export function projectCurrentTodos(entries: readonly Entry[]) {
  const state = projectTodoState(entries)
  if (!state?.todos.length || state.hasNewerUser) return undefined
  const incomplete = state.todos.some((todo) => todo.status !== 'completed')
  if (incomplete && state.hasNewerTerminalAssistant) {
    return undefined
  }
  return state.todos
}

/** 只为显式无输入续作投影当前用户轮次内的未完成计划。 */
export function projectRecoverableTodos(entries: readonly Entry[]) {
  const state = projectTodoState(entries)
  if (
    !state?.todos.length ||
    state.hasNewerUser ||
    state.todos.every((todo) => todo.status === 'completed')
  ) {
    return undefined
  }
  return state.todos
}

function toMessage(
  entry: Extract<Entry, { type: 'message' }>,
  toolResults: ReadonlyMap<string, ToolResultMessage>,
) {
  const { message } = entry
  if (
    message.role === 'custom' &&
    message.customType === SESSION_CUSTOM_TYPE.userInput
  ) {
    const details = structuredMessageDetails(message.details)
    if (!details) return undefined
    return {
      attachments: details.attachments.map(
        ({ content: _content, kind: _kind, ...attachment }) => attachment,
      ),
      content: details.content,
      contextItems: details.contextItems,
      entryId: entry.id,
      role: 'user' as const,
      seq: entry.seq,
      timestamp: message.timestamp,
    } satisfies AgentSessionMessage
  }
  if (message.role !== 'user' && message.role !== 'assistant') return undefined
  const parts: AgentSessionMessagePart[] =
    message.role === 'assistant'
      ? message.content.flatMap<AgentSessionMessagePart>((content) => {
          if (content.type === 'text') {
            return content.text ? [{ text: content.text, type: 'text' }] : []
          }
          if (content.type === 'thinking') {
            return content.thinking
              ? [{ reasoning: content.thinking, type: 'reasoning' }]
              : []
          }
          return [
            {
              tool: toSessionTool(content, toolResults),
              type: 'tool',
            },
          ]
        })
      : []
  const reasoning =
    message.role === 'assistant'
      ? message.content
          .filter((content) => content.type === 'thinking')
          .map((content) => content.thinking)
          .join('')
      : ''
  const tools =
    message.role === 'assistant'
      ? parts.flatMap((part) => (part.type === 'tool' ? [part.tool] : []))
      : []
  return {
    content: messageText(message),
    entryId: entry.id,
    ...(parts.length ? { parts } : {}),
    ...(reasoning ? { reasoning } : {}),
    role: message.role,
    seq: entry.seq,
    ...(message.role === 'assistant' ? { stopReason: message.stopReason } : {}),
    timestamp: message.timestamp,
    ...(tools.length ? { tools } : {}),
  } satisfies AgentSessionMessage
}

function sessionFailure(error: unknown): never {
  if (error instanceof AgentRuntimeError) throw error
  if (error instanceof SessionError && error.code === 'not_found') {
    throw new AgentRuntimeError('SESSION_NOT_FOUND', '会话不存在。', 404)
  }
  throw new AgentRuntimeError(
    'SESSION_PERSISTENCE_FAILED',
    '会话持久化操作失败。',
    500,
  )
}

/** 在 Pi SessionRepo 上提供当前主分支的最小会话能力。 */
export class AgentSessionService {
  private readonly projection?: AgentSessionProjection
  private readonly repository: AgentSessionRepository
  private listCache?: AgentSessionInfo[]
  private metadataIndex?: Promise<Map<string, AgentSessionMetadata>>
  private repositoryTail = Promise.resolve()
  private readonly trajectoryCache = new Map<string, AgentTrajectory>()

  constructor(
    repository: AgentSessionRepository,
    projection?: AgentSessionProjection,
  ) {
    this.repository = repository
    this.projection = projection
  }

  async create(input: {
    cwd: string
    modelId: string
    name?: string
    providerId: string
  }) {
    let session: Session<AgentSessionMetadata> | undefined
    try {
      const config: AgentSessionModelConfig = {
        modelId: input.modelId,
        providerId: input.providerId,
        schemaVersion: 1,
      }
      session = await this.serializeRepository(() =>
        this.repository.create({
          cwd: input.cwd,
          metadata: { ...config },
        }),
      )
      if (input.name !== undefined) await session.setName(input.name)
      const metadata = await session.getMetadata()
      if (this.metadataIndex) {
        ;(await this.metadataIndex).set(metadata.id, metadata)
      }
      const info = toInfo(metadata, config, input.name)
      this.updateListCache(info)
      await this.projectChanged(info.id)
      return info
    } catch (error) {
      if (session) {
        const metadata = await session.getMetadata().catch(() => undefined)
        if (metadata)
          await this.serializeRepository(() =>
            this.repository.delete(metadata),
          ).catch(() => undefined)
      }
      return sessionFailure(error)
    }
  }

  async list() {
    try {
      if (this.projection) {
        try {
          return await this.projection.list()
        } catch {
          return await this.listFromRepository(false)
        }
      }
      return await this.listFromRepository(true)
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async listFromSource() {
    try {
      return await this.listFromRepository(false)
    } catch (error) {
      return sessionFailure(error)
    }
  }

  private async listFromRepository(cache: boolean) {
    if (cache && this.listCache) return this.listCache
    const sessions: AgentSessionInfo[] = []
    for (const metadata of (await this.getMetadataIndex()).values()) {
      const session = await this.repository.open(metadata)
      const [name, modelChange, archiveEntry] = await Promise.all([
        session.getName(),
        session.findEntryOnBranch({
          order: 'newestFirst',
          type: 'model_change',
        }),
        session.findEntryOnBranch({
          customType: SESSION_CUSTOM_TYPE.sessionArchiveChanged,
          order: 'newestFirst',
          type: 'custom',
        }),
      ])
      sessions.push(
        toInfo(
          metadata,
          configFromModelChange(modelChange, readHeaderConfig(metadata)),
          name,
          archiveState(archiveEntry),
        ),
      )
    }
    sessions.sort((left, right) => right.createdAt - left.createdAt)
    if (cache) this.listCache = sessions
    return sessions
  }

  changed(id: string) {
    this.projectChanged(id)
  }

  private projectChanged(id: string) {
    this.trajectoryCache.delete(id)
    void this.projection?.changed(id).catch(() => {
      // 投影失败不得回滚已成功的 JSONL mutation。
    })
  }

  private projectDeleted(id: string) {
    this.trajectoryCache.delete(id)
    return this.projection?.deleted(id).catch(() => {
      // 启动对账会从 JSONL 缺失事实中补偿删除。
    })
  }

  async get(id: string): Promise<AgentSessionDetail> {
    const opened = await this.openSession(id)
    try {
      const [name, stats, contextUsageEntry, pluginSelection] =
        await Promise.all([
          opened.session.getName(),
          opened.session.getStats(),
          opened.session.findEntryOnBranch({
            customType: SESSION_CUSTOM_TYPE.contextUsageSnapshot,
            order: 'newestFirst',
            type: 'custom',
          }),
          opened.session.findEntryOnBranch({
            customType: SESSION_CUSTOM_TYPE.pluginSelection,
            order: 'newestFirst',
            type: 'custom',
          }),
        ])
      const contextUsage = parseContextUsageSnapshot(
        contextUsageEntry?.type === 'custom'
          ? contextUsageEntry.data
          : undefined,
        opened.config,
      )
      return {
        ...toInfo(opened.metadata, opened.config, name, opened.archived),
        pluginIds: (() => {
          const entry = pluginSelection
          const ids =
            entry?.type === 'custom'
              ? (entry.data as { pluginIds?: unknown }).pluginIds
              : undefined
          return Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === 'string')
            : []
        })(),
        ...(contextUsage ? { contextUsage } : {}),
        stats,
      }
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async rename(id: string, name: string | undefined) {
    const opened = await this.openSession(id)
    try {
      await opened.session.setName(name)
      const info = toInfo(opened.metadata, opened.config, name, opened.archived)
      this.updateListCache(info)
      await this.projectChanged(id)
      return info
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async updateModel(
    id: string,
    input: { modelId: string; providerId: string },
  ) {
    const opened = await this.openSession(id)
    if (opened.archived) {
      throw new AgentRuntimeError(
        'SESSION_ARCHIVED',
        '已归档的会话需要恢复后才能继续。',
        409,
      )
    }
    const config: AgentSessionModelConfig = { ...input, schemaVersion: 1 }
    try {
      await opened.session.appendEntry(
        {
          id: opened.session.idGenerator.next(),
          modelId: input.modelId,
          provider: input.providerId,
          type: 'model_change',
        },
        'main',
      )
      const info = toInfo(
        opened.metadata,
        config,
        await opened.session.getName(),
        false,
      )
      this.updateListCache(info)
      await this.projectChanged(id)
      return info
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async archive(id: string, archived: boolean) {
    const opened = await this.openSession(id)
    try {
      await opened.session.appendCustomEntry(
        SESSION_CUSTOM_TYPE.sessionArchiveChanged,
        { archived },
      )
      const info = toInfo(
        opened.metadata,
        opened.config,
        await opened.session.getName(),
        archived,
      )
      this.updateListCache(info)
      await this.projectChanged(id)
      return info
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async messages(
    id: string,
    options: { before?: number; limit: number },
  ): Promise<AgentSessionMessagePage> {
    const opened = await this.openSession(id)
    try {
      // ponytail: 首版主分支分页在内存中过滤；100k entries 压测不达标时改用上游 before-cursor/index。
      const branchEntries = await opened.session.findEntriesOnBranch({
        order: 'newestFirst',
      })
      const entries = branchEntries.filter(
        (entry): entry is Extract<Entry, { type: 'message' }> =>
          entry.type === 'message',
      )
      const toolResults = new Map<string, ToolResultMessage>()
      for (const entry of entries) {
        if (entry.message.role === 'toolResult') {
          toolResults.set(entry.message.toolCallId, entry.message)
        }
      }
      const candidates: AgentSessionMessage[] = []
      for (const entry of entries) {
        if (options.before !== undefined && entry.seq >= options.before)
          continue
        const message = toMessage(entry, toolResults)
        if (message) candidates.push(message)
        if (candidates.length > options.limit) break
      }
      const selected = candidates.slice(0, options.limit)
      return {
        items: selected.toReversed(),
        nextCursor:
          candidates.length > options.limit
            ? (selected.at(-1)?.seq ?? null)
            : null,
        ...(options.before === undefined
          ? {
              todos: projectCurrentTodos(branchEntries),
            }
          : {}),
      }
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async trajectory(id: string, active: boolean): Promise<AgentTrajectory> {
    const cached = active ? undefined : this.trajectoryCache.get(id)
    if (cached) return cached
    const opened = await this.open(id)
    const trajectory = projectAgentTrajectory({
      active,
      entries: opened.entries,
      model: opened.config.modelId,
      sessionId: id,
    })
    if (!active) this.trajectoryCache.set(id, trajectory)
    return trajectory
  }

  async trajectoryRecord(
    id: string,
    recordId: string,
    active: boolean,
  ): Promise<AgentTrajectoryRecord> {
    const record = (await this.trajectory(id, active)).records.find(
      (candidate) => candidate.id === recordId,
    )
    if (!record) {
      throw new AgentRuntimeError(
        'TRAJECTORY_RECORD_NOT_FOUND',
        '轨迹记录不存在。',
        404,
      )
    }
    return record
  }

  async attachment(id: string, entryId: string, contentIndex: number) {
    if (!Number.isSafeInteger(contentIndex) || contentIndex < 0) {
      throw new AgentRuntimeError(
        'INVALID_SESSION_REQUEST',
        '附件参数无效。',
        400,
      )
    }
    const opened = await this.openSession(id)
    try {
      const entry = (
        await opened.session.findEntriesOnBranch({ order: 'oldestFirst' })
      ).find((candidate) => candidate.id === entryId)
      if (
        entry?.type !== 'message' ||
        entry.message.role !== 'custom' ||
        entry.message.customType !== SESSION_CUSTOM_TYPE.userInput ||
        !Array.isArray(entry.message.content)
      ) {
        throw new AgentRuntimeError('ATTACHMENT_NOT_FOUND', '附件不存在。', 404)
      }
      const details = structuredMessageDetails(entry.message.details)
      const attachment = details?.attachments.find(
        (candidate) => candidate.contentIndex === contentIndex,
      )
      if (attachment?.kind !== 'image') {
        throw new AgentRuntimeError('ATTACHMENT_NOT_FOUND', '附件不存在。', 404)
      }
      return {
        data: attachment.content,
        mimeType: attachment.mimeType,
        name: attachment.name,
      }
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async open(id: string): Promise<OpenAgentSession> {
    const opened = await this.openSession(id)
    try {
      const entries = await opened.session.findEntriesOnBranch({
        order: 'oldestFirst',
      })
      return { ...opened, entries }
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async delete(id: string) {
    try {
      const metadata = await this.findMetadata(id)
      await this.serializeRepository(() => this.repository.delete(metadata))
      if (this.metadataIndex) (await this.metadataIndex).delete(metadata.id)
      if (this.listCache) {
        this.listCache = this.listCache.filter((session) => session.id !== id)
      }
      await this.projectDeleted(id)
    } catch (error) {
      return sessionFailure(error)
    }
  }

  private async openSession(id: string) {
    try {
      const metadata = await this.findMetadata(id)
      const session = await this.repository.open(metadata)
      const [modelChange, archiveEntry] = await Promise.all([
        session.findEntryOnBranch({
          order: 'newestFirst',
          type: 'model_change',
        }),
        session.findEntryOnBranch({
          customType: SESSION_CUSTOM_TYPE.sessionArchiveChanged,
          order: 'newestFirst',
          type: 'custom',
        }),
      ])
      return {
        archived: archiveState(archiveEntry),
        config: configFromModelChange(modelChange, readHeaderConfig(metadata)),
        metadata,
        session,
      }
    } catch (error) {
      return sessionFailure(error)
    }
  }

  private updateListCache(info: AgentSessionInfo) {
    if (!this.listCache) return
    const index = this.listCache.findIndex((session) => session.id === info.id)
    if (index === -1) {
      this.listCache.unshift(info)
      return
    }
    this.listCache[index] = info
  }

  private async findMetadata(id: string) {
    if (!sessionIdPattern.test(id)) {
      throw new AgentRuntimeError(
        'INVALID_SESSION_REQUEST',
        'Session ID 无效。',
        400,
      )
    }
    const hadIndex = this.metadataIndex !== undefined
    let metadata = (await this.getMetadataIndex()).get(id)
    if (!metadata && hadIndex) {
      metadata = (await this.refreshMetadataIndex()).get(id)
    }
    if (!metadata) {
      throw new AgentRuntimeError('SESSION_NOT_FOUND', '会话不存在。', 404)
    }
    return metadata
  }

  private async getMetadataIndex() {
    return this.metadataIndex ?? this.refreshMetadataIndex()
  }

  private async refreshMetadataIndex() {
    // ponytail: 单进程缓存适合本地 Server；多进程写入时改为仓储版本号或变更通知。
    const loading = this.serializeRepository(() => this.repository.list()).then(
      (sessions) => new Map(sessions.map((session) => [session.id, session])),
    )
    this.metadataIndex = loading
    this.listCache = undefined
    try {
      return await loading
    } catch (error) {
      if (this.metadataIndex === loading) this.metadataIndex = undefined
      throw error
    }
  }

  private serializeRepository<T>(operation: () => Promise<T>) {
    // ponytail: Pi 的目录枚举会逐项 lstat；单进程串行化创建/删除/扫描可避免文件在枚举中途消失。
    const result = this.repositoryTail.then(operation)
    this.repositoryTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
