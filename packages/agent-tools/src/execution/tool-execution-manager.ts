import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  BUILTIN_TOOL_NAME,
  TOOL_EXECUTION_STATE,
  type ToolExecutionState,
} from '@oh-my-harness/shared'
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core'

const DEFAULT_WAIT_MS = 5_000
const DEFAULT_READ_BYTES = 16_000
export const MAX_TOOL_EXECUTION_OUTPUT_BYTES = 256 * 1024
const isSafeSegment = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/u.test(value)

type PersistedExecutionState = Exclude<
  ToolExecutionState,
  typeof TOOL_EXECUTION_STATE.COMPLETE
>

export interface ToolExecutionSnapshot {
  background: boolean
  canRestart: boolean
  canStop: boolean
  completedAt?: number
  error?: string
  executionId: string
  label: string
  output?: string
  previousExecutionId?: string
  runId: string
  service?: { command: string; cwd: string; removedAt?: number }
  sessionId: string
  startedAt: number
  state: PersistedExecutionState
  toolCallId: string
  toolName: string
}

export interface ToolExecutionOutput {
  nextOffset: number | null
  offset: number
  text: string
  totalBytes: number
  truncated: boolean
}

export type ToolExecutionReceipt = AgentToolResult<{
  executionId: string
  executionState: ToolExecutionState
  [key: string]: unknown
}>

export interface ToolExecutionRunOptions {
  execute(
    signal: AbortSignal,
    update: AgentToolUpdateCallback,
  ): Promise<AgentToolResult<unknown>>
  label: string
  previousExecutionId?: string
  restart?: () => Promise<ToolExecutionRunOptions>
  runId: string
  service?: { command: string; cwd: string }
  sessionId: string
  signal?: AbortSignal
  throwOnFailure?: boolean
  toolCallId: string
  toolName: string
}

interface StoredOutput {
  offset: number
  text: string
  totalBytes: number
  truncated: boolean
}

interface ExecutionRecord {
  changing?: boolean
  completion: Promise<ExecutionCompletion>
  controller: AbortController
  outputFailure?: Error
  outputWrites: Promise<void>
  restart?: ToolExecutionRunOptions['restart']
  snapshot: ToolExecutionSnapshot
  stateWrites: Promise<void>
  stopRequested: boolean
}

type ExecutionCompletion =
  | { error: Error; result?: never }
  | { error?: never; result: AgentToolResult<unknown> }

const isActive = (state: PersistedExecutionState) =>
  state === TOOL_EXECUTION_STATE.RUNNING ||
  state === TOOL_EXECUTION_STATE.STOPPING

const executionFailure = (error: Error) =>
  ({
    content: [
      { text: `Tool execution failed: ${error.message}`, type: 'text' },
    ],
    details: { executionState: TOOL_EXECUTION_STATE.FAILED },
  }) satisfies AgentToolResult<unknown>

const resultText = (result: AgentToolResult<unknown>) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

const withExecutionDetails = (
  result: AgentToolResult<unknown>,
  executionId: string,
  executionState: ToolExecutionState,
) =>
  ({
    ...result,
    details: {
      ...(result.details && typeof result.details === 'object'
        ? result.details
        : {}),
      executionId,
      executionState,
    },
  }) as ToolExecutionReceipt

const trimUtf8Tail = (source: Buffer, limit: number) => {
  if (source.byteLength <= limit) return source
  let start = source.byteLength - limit
  while (start < source.byteLength && (source[start]! & 0xc0) === 0x80) start++
  return source.subarray(start)
}

const sliceUtf8 = (source: Buffer, start: number, limit: number) => {
  let end = Math.min(source.byteLength, start + limit)
  while (
    end > start &&
    end < source.byteLength &&
    (source[end]! & 0xc0) === 0x80
  )
    end--
  return source.subarray(start, end)
}

const safeError = (error: unknown) =>
  error instanceof Error ? error : new Error('Tool execution failed.')

const cloneSnapshot = (snapshot: ToolExecutionSnapshot) =>
  structuredClone(snapshot)

/** 管理一次且仅一次的工具调用，并在等待预算后把其生命周期移交给后台。 */
export class ToolExecutionManager {
  private readonly directory: string
  private readonly executions = new Map<string, ExecutionRecord>()
  private readonly listeners = new Map<
    string,
    Set<(snapshot: ToolExecutionSnapshot) => void>
  >()
  private readonly releasedRuns = new Map<string, () => Promise<unknown>>()
  private readonly persist: (snapshot: ToolExecutionSnapshot) => Promise<void>
  private readonly waitMs: number
  private closed = false

  constructor(
    directory: string,
    persist: (snapshot: ToolExecutionSnapshot) => Promise<void>,
    waitMs = DEFAULT_WAIT_MS,
  ) {
    this.directory = resolve(directory)
    this.persist = persist
    this.waitMs = waitMs
  }

  /** 启动工具一次；预算耗尽只返回 running，不会复制执行。 */
  async run(options: ToolExecutionRunOptions): Promise<ToolExecutionReceipt> {
    if (this.closed) throw new Error('工具执行管理器已关闭。')
    const executionId = randomUUID()
    const controller = new AbortController()
    const record: ExecutionRecord = {
      completion: Promise.resolve({ result: { content: [], details: {} } }),
      controller,
      outputWrites: Promise.resolve(),
      restart: options.restart,
      snapshot: {
        background: false,
        canRestart: Boolean(options.restart),
        canStop: true,
        executionId,
        label: options.label,
        ...(options.previousExecutionId
          ? { previousExecutionId: options.previousExecutionId }
          : {}),
        runId: options.runId,
        ...(options.service ? { service: { ...options.service } } : {}),
        sessionId: options.sessionId,
        startedAt: Date.now(),
        state: TOOL_EXECUTION_STATE.RUNNING,
        toolCallId: options.toolCallId,
        toolName: options.toolName,
      },
      stateWrites: Promise.resolve(),
      stopRequested: false,
    }
    this.executions.set(executionId, record)
    try {
      await this.persistAndNotify(record)
    } catch (error) {
      this.executions.delete(executionId)
      throw error
    }

    const abortFromRun = () => {
      if (!record.snapshot.background) controller.abort(options.signal?.reason)
    }
    options.signal?.addEventListener('abort', abortFromRun, { once: true })
    if (options.signal?.aborted) abortFromRun()

    record.completion = this.execute(record, options)
    void record.completion.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = new Promise<Record<string, never>>((resolve) => {
      timer = setTimeout(() => resolve({}), this.waitMs)
    })
    const outcome = await Promise.race([
      record.completion.then((completion) => ({ completion })),
      wait,
    ])
    if (timer) clearTimeout(timer)
    if ('completion' in outcome) {
      options.signal?.removeEventListener('abort', abortFromRun)
      return this.completionResult(record, outcome.completion, options)
    }

    options.signal?.removeEventListener('abort', abortFromRun)
    const background = await this.markBackground(record)
    if (!background) {
      return this.completionResult(record, await record.completion, options)
    }
    return {
      content: [
        {
          type: 'text',
          text: `Tool is still running. executionId=${executionId}. Query state with get_tool_execution({"executionId":"${executionId}"}); read output with read_tool_result({"toolCallId":${JSON.stringify(options.toolCallId)}}).`,
        },
      ],
      details: {
        executionId,
        executionState: TOOL_EXECUTION_STATE.RUNNING,
      },
    } as ToolExecutionReceipt
  }

  listExecutions(sessionId: string) {
    return [...this.executions.values()]
      .filter((record) => record.snapshot.sessionId === sessionId)
      .map((record) => cloneSnapshot(record.snapshot))
      .sort((left, right) => right.startedAt - left.startedAt)
  }

  getExecution(sessionId: string, executionId: string) {
    const record = this.find(sessionId, executionId)
    return cloneSnapshot(record.snapshot)
  }

  findByToolCallId(sessionId: string, toolCallId: string) {
    const record = [...this.executions.values()].find(
      (candidate) =>
        candidate.snapshot.sessionId === sessionId &&
        candidate.snapshot.toolCallId === toolCallId,
    )
    return record ? cloneSnapshot(record.snapshot) : undefined
  }

  /** 按绝对字节偏移读取有界尾部；请求落在已截断区时从最早保留位置开始。 */
  async readOutput(
    sessionId: string,
    executionId: string,
    offset = 0,
    limit = DEFAULT_READ_BYTES,
  ): Promise<ToolExecutionOutput> {
    this.find(sessionId, executionId)
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error('输出偏移无效。')
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_TOOL_EXECUTION_OUTPUT_BYTES
    )
      throw new Error('输出读取长度无效。')
    const stored = await this.readStoredOutput(sessionId, executionId)
    const retained = Buffer.from(stored.text)
    let relative = Math.max(
      0,
      Math.min(retained.byteLength, offset - stored.offset),
    )
    while (
      relative < retained.byteLength &&
      (retained[relative]! & 0xc0) === 0x80
    )
      relative++
    const chunk = sliceUtf8(retained, relative, limit)
    const actualOffset = stored.offset + relative
    const nextOffset = actualOffset + chunk.byteLength
    return {
      nextOffset: nextOffset < stored.totalBytes ? nextOffset : null,
      offset: actualOffset,
      text: chunk.toString('utf8'),
      totalBytes: stored.totalBytes,
      truncated: stored.truncated || offset < stored.offset,
    }
  }

  async stopExecution(sessionId: string, executionId: string) {
    const record = this.find(sessionId, executionId)
    if (!isActive(record.snapshot.state)) return cloneSnapshot(record.snapshot)
    record.stopRequested = true
    await this.updateSnapshot(record, {
      canStop: false,
      state: TOOL_EXECUTION_STATE.STOPPING,
    })
    record.controller.abort(new Error('Tool execution stopped.'))
    await record.completion
    return cloneSnapshot(record.snapshot)
  }

  async restartExecution(sessionId: string, executionId: string) {
    const record = this.find(sessionId, executionId)
    if (!record.restart) throw new Error('该工具执行不可重启。')
    this.beginLifecycleChange(record)
    try {
      if (isActive(record.snapshot.state))
        await this.stopExecution(sessionId, executionId)
      const next = await record.restart()
      const result = await this.run({
        ...next,
        previousExecutionId: executionId,
      })
      const nextId = (result.details as { executionId?: unknown } | undefined)
        ?.executionId
      if (typeof nextId !== 'string') throw new Error('工具执行重启失败。')
      return this.getExecution(sessionId, nextId)
    } finally {
      record.changing = false
    }
  }

  /** 停止受管服务后持久化移除标记，执行历史和有界日志仍可查询。 */
  async removeService(sessionId: string, executionId: string) {
    const record = this.find(sessionId, executionId)
    if (
      !record.snapshot.service ||
      record.snapshot.toolName !== BUILTIN_TOOL_NAME.BASH
    )
      throw new Error('该工具执行不是受管服务。')
    if (record.snapshot.service.removedAt !== undefined)
      return cloneSnapshot(record.snapshot)
    this.beginLifecycleChange(record)
    try {
      await this.stopExecution(sessionId, executionId)
      if (isActive(record.snapshot.state))
        throw new Error('服务尚未停止，请稍后重试。')
      await this.mutate(record, async () => {
        const snapshot = {
          ...record.snapshot,
          canRestart: false,
          service: { ...record.snapshot.service!, removedAt: Date.now() },
        }
        // 写盘失败时仍保留可见条目；不能先改内存再尝试持久化。
        await this.persist(snapshot)
        record.snapshot = snapshot
        record.restart = undefined
        this.notify(snapshot)
      })
      return cloneSnapshot(record.snapshot)
    } finally {
      record.changing = false
    }
  }

  /** 同一实例的重启和删除互斥，旧实例不能形成新的重启分叉。 */
  private beginLifecycleChange(record: ExecutionRecord) {
    if (record.changing) throw new Error('服务操作进行中，请稍后重试。')
    if (record.snapshot.service?.removedAt !== undefined)
      throw new Error('服务已删除，不可重启。')
    const replaced = [...this.executions.values()].some(
      (candidate) =>
        candidate.snapshot.previousExecutionId === record.snapshot.executionId,
    )
    if (replaced) throw new Error('服务已有新实例，请刷新后操作。')
    record.changing = true
  }

  subscribeExecution(
    sessionId: string,
    listener: (snapshot: ToolExecutionSnapshot) => void,
  ) {
    const listeners = this.listeners.get(sessionId) ?? new Set()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(sessionId)
    }
  }

  /** Run 结束后延迟释放仍被后台任务使用的工具资源。 */
  async releaseRun(runId: string, dispose: () => Promise<unknown>) {
    if (this.hasActiveRun(runId)) {
      this.releasedRuns.set(runId, dispose)
      return
    }
    await dispose()
  }

  /** 从 JSONL 快照恢复目录；失去本地句柄的活跃任务只标记 interrupted。 */
  async restore(
    sessionId: string,
    snapshots: readonly ToolExecutionSnapshot[],
  ) {
    for (const snapshot of snapshots) {
      if (
        snapshot.sessionId !== sessionId ||
        this.executions.has(snapshot.executionId)
      )
        continue
      const restored = cloneSnapshot(snapshot)
      const interrupted = isActive(restored.state)
      if (interrupted) {
        restored.state = TOOL_EXECUTION_STATE.INTERRUPTED
        restored.completedAt = Date.now()
        restored.error = 'Host restarted before the tool execution completed.'
      }
      restored.canRestart = false
      restored.canStop = false
      const record: ExecutionRecord = {
        completion: Promise.resolve({ result: { content: [], details: {} } }),
        controller: new AbortController(),
        outputWrites: Promise.resolve(),
        snapshot: restored,
        stateWrites: Promise.resolve(),
        stopRequested: false,
      }
      this.executions.set(restored.executionId, record)
      if (interrupted) await this.persistAndNotify(record)
    }
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const active = [...this.executions.values()].filter((record) =>
      isActive(record.snapshot.state),
    )
    active.forEach((record) =>
      record.controller.abort(new Error('Host closed.')),
    )
    await Promise.all(active.map((record) => record.completion))
    const disposals = [...this.releasedRuns.values()]
    this.releasedRuns.clear()
    await Promise.allSettled(disposals.map((dispose) => dispose()))
  }

  async deleteSession(sessionId: string) {
    const records = [...this.executions.values()].filter(
      (record) => record.snapshot.sessionId === sessionId,
    )
    await Promise.all(
      records
        .filter((record) => isActive(record.snapshot.state))
        .map((record) =>
          this.stopExecution(sessionId, record.snapshot.executionId),
        ),
    )
    records.forEach((record) =>
      this.executions.delete(record.snapshot.executionId),
    )
    await rm(this.outputDirectory(sessionId), { force: true, recursive: true })
  }

  private async execute(
    record: ExecutionRecord,
    options: ToolExecutionRunOptions,
  ) {
    const update: AgentToolUpdateCallback = (result) => {
      this.queueOutput(record, result)
    }
    try {
      const result = await options.execute(record.controller.signal, update)
      this.queueOutput(record, result)
      await record.outputWrites
      if (record.outputFailure) throw record.outputFailure
      const details = result.details as
        { exitCode?: unknown; signal?: unknown; timedOut?: unknown } | undefined
      const failed =
        (typeof details?.exitCode === 'number' && details.exitCode !== 0) ||
        Boolean(details?.signal) ||
        details?.timedOut === true
      await this.updateSnapshot(record, {
        canStop: false,
        completedAt: Date.now(),
        output: resultText(result).slice(-DEFAULT_READ_BYTES),
        state: failed
          ? TOOL_EXECUTION_STATE.FAILED
          : TOOL_EXECUTION_STATE.SUCCEEDED,
      })
      await this.disposeReleasedRun(record.snapshot.runId)
      return { result } satisfies ExecutionCompletion
    } catch (value) {
      const error = safeError(value)
      const state = record.stopRequested
        ? TOOL_EXECUTION_STATE.STOPPED
        : this.closed
          ? TOOL_EXECUTION_STATE.INTERRUPTED
          : TOOL_EXECUTION_STATE.FAILED
      await this.updateSnapshot(record, {
        canStop: false,
        completedAt: Date.now(),
        error: error.message,
        state,
      }).catch(() => undefined)
      await this.disposeReleasedRun(record.snapshot.runId)
      return { error } satisfies ExecutionCompletion
    }
  }

  private completionResult(
    record: ExecutionRecord,
    completion: ExecutionCompletion,
    options: ToolExecutionRunOptions,
  ) {
    if (completion.error) {
      if (options.throwOnFailure) throw completion.error
      return withExecutionDetails(
        executionFailure(completion.error),
        record.snapshot.executionId,
        TOOL_EXECUTION_STATE.FAILED,
      )
    }
    return withExecutionDetails(
      completion.result,
      record.snapshot.executionId,
      record.snapshot.state === TOOL_EXECUTION_STATE.FAILED
        ? TOOL_EXECUTION_STATE.FAILED
        : TOOL_EXECUTION_STATE.COMPLETE,
    )
  }

  private async markBackground(record: ExecutionRecord) {
    let changed = false
    await this.mutate(record, async () => {
      if (record.snapshot.state !== TOOL_EXECUTION_STATE.RUNNING) return
      record.snapshot.background = true
      await this.persistAndNotify(record)
      changed = true
    })
    return changed
  }

  private async updateSnapshot(
    record: ExecutionRecord,
    patch: Partial<ToolExecutionSnapshot>,
  ) {
    await this.mutate(record, async () => {
      Object.assign(record.snapshot, patch)
      await this.persistAndNotify(record)
    })
  }

  private mutate(record: ExecutionRecord, operation: () => Promise<void>) {
    const write = record.stateWrites.then(operation, operation)
    record.stateWrites = write.catch(() => undefined)
    return write
  }

  private queueOutput(
    record: ExecutionRecord,
    result: AgentToolResult<unknown>,
  ) {
    record.outputWrites = record.outputWrites
      .then(async () => {
        const reportedBytes = (
          result.details as { totalOutputBytes?: unknown } | undefined
        )?.totalOutputBytes
        await this.storeOutput(
          record.snapshot,
          resultText(result),
          typeof reportedBytes === 'number' &&
            Number.isSafeInteger(reportedBytes) &&
            reportedBytes >= 0
            ? reportedBytes
            : undefined,
        )
        this.notify(record.snapshot)
      })
      .catch((error: unknown) => {
        record.outputFailure = safeError(error)
        record.controller.abort(record.outputFailure)
      })
  }

  private async storeOutput(
    snapshot: ToolExecutionSnapshot,
    text: string,
    reportedBytes?: number,
  ) {
    const source = Buffer.from(text)
    const retained = trimUtf8Tail(source, MAX_TOOL_EXECUTION_OUTPUT_BYTES)
    const totalBytes = Math.max(source.byteLength, reportedBytes ?? 0)
    const stored: StoredOutput = {
      offset: totalBytes - retained.byteLength,
      text: retained.toString('utf8'),
      totalBytes,
      truncated: retained.byteLength < totalBytes,
    }
    const directory = this.outputDirectory(snapshot.sessionId)
    await mkdir(directory, { mode: 0o700, recursive: true })
    await chmod(directory, 0o700)
    const path = this.outputPath(snapshot.sessionId, snapshot.executionId)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(stored), { mode: 0o600 })
      await chmod(temporary, 0o600)
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private async readStoredOutput(sessionId: string, executionId: string) {
    try {
      const value = JSON.parse(
        await readFile(this.outputPath(sessionId, executionId), 'utf8'),
      ) as Partial<StoredOutput>
      if (
        typeof value.text !== 'string' ||
        !Number.isSafeInteger(value.offset) ||
        !Number.isSafeInteger(value.totalBytes) ||
        typeof value.truncated !== 'boolean'
      )
        throw new Error('工具输出记录无效。')
      return value as StoredOutput
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { offset: 0, text: '', totalBytes: 0, truncated: false }
      throw error
    }
  }

  private outputDirectory(sessionId: string) {
    if (!isSafeSegment(sessionId)) throw new Error('会话标识无效。')
    return join(this.directory, 'tool-output', sessionId)
  }

  private outputPath(sessionId: string, executionId: string) {
    if (!isSafeSegment(executionId)) throw new Error('执行标识无效。')
    return join(this.outputDirectory(sessionId), `${executionId}.json`)
  }

  private find(sessionId: string, executionId: string) {
    const record = this.executions.get(executionId)
    if (!record || record.snapshot.sessionId !== sessionId)
      throw new Error('工具执行不存在。')
    return record
  }

  private hasActiveRun(runId: string) {
    return [...this.executions.values()].some(
      (record) =>
        record.snapshot.runId === runId && isActive(record.snapshot.state),
    )
  }

  private async disposeReleasedRun(runId: string) {
    if (this.hasActiveRun(runId)) return
    const dispose = this.releasedRuns.get(runId)
    if (!dispose) return
    this.releasedRuns.delete(runId)
    await dispose()
  }

  private async persistAndNotify(record: ExecutionRecord) {
    await this.persist(cloneSnapshot(record.snapshot))
    this.notify(record.snapshot)
  }

  private notify(snapshot: ToolExecutionSnapshot) {
    for (const listener of this.listeners.get(snapshot.sessionId) ?? []) {
      try {
        listener(cloneSnapshot(snapshot))
      } catch {
        // 观察者不能改变已持久化的执行结果。
      }
    }
  }
}

/** 严格解析 JSONL 中的工具执行状态，拒绝旧形状和跨会话伪造。 */
export const parseToolExecutionSnapshot = (
  value: unknown,
): ToolExecutionSnapshot | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const data = value as Record<string, unknown>
  if (data.service !== undefined) {
    if (
      !data.service ||
      typeof data.service !== 'object' ||
      Array.isArray(data.service)
    )
      return
    const service = data.service as Record<string, unknown>
    if (
      typeof service.command !== 'string' ||
      !service.command.trim() ||
      service.command.includes('\0') ||
      typeof service.cwd !== 'string' ||
      !service.cwd ||
      service.cwd.includes('\0')
    )
      return
    if (
      service.removedAt !== undefined &&
      (!Number.isSafeInteger(service.removedAt) ||
        (service.removedAt as number) < 0 ||
        isActive(data.state as PersistedExecutionState) ||
        data.canRestart !== false ||
        data.canStop !== false)
    )
      return
  }
  const states = new Set<PersistedExecutionState>([
    TOOL_EXECUTION_STATE.FAILED,
    TOOL_EXECUTION_STATE.INTERRUPTED,
    TOOL_EXECUTION_STATE.RUNNING,
    TOOL_EXECUTION_STATE.STOPPED,
    TOOL_EXECUTION_STATE.STOPPING,
    TOOL_EXECUTION_STATE.SUCCEEDED,
  ])
  if (
    typeof data.background !== 'boolean' ||
    typeof data.canRestart !== 'boolean' ||
    typeof data.canStop !== 'boolean' ||
    typeof data.executionId !== 'string' ||
    !isSafeSegment(data.executionId) ||
    typeof data.label !== 'string' ||
    typeof data.runId !== 'string' ||
    !isSafeSegment(data.runId) ||
    typeof data.sessionId !== 'string' ||
    !isSafeSegment(data.sessionId) ||
    !Number.isSafeInteger(data.startedAt) ||
    !states.has(data.state as PersistedExecutionState) ||
    typeof data.toolCallId !== 'string' ||
    typeof data.toolName !== 'string' ||
    (data.completedAt !== undefined &&
      !Number.isSafeInteger(data.completedAt)) ||
    (data.error !== undefined && typeof data.error !== 'string') ||
    (data.output !== undefined && typeof data.output !== 'string') ||
    (data.previousExecutionId !== undefined &&
      (typeof data.previousExecutionId !== 'string' ||
        !isSafeSegment(data.previousExecutionId)))
  )
    return
  return data as unknown as ToolExecutionSnapshot
}
