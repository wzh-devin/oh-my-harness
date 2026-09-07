import type { Entry } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'

import { AgentRuntimeError } from '../error/agent-runtime-error.ts'
import { structuredMessageDetails } from '../execution/attachment-message.ts'
import { SESSION_CUSTOM_TYPE } from '../session/session-custom-type.ts'

export type AgentTrajectoryLane = 'input' | 'model' | 'tools'
export type AgentTrajectoryRecordKind =
  'assistant' | 'context' | 'request' | 'system' | 'tool' | 'user'
export type AgentTrajectoryStatus =
  'aborted' | 'completed' | 'failed' | 'interrupted' | 'running'

interface TrajectoryRecordBase {
  position: number
  runId: string
  runNumber: number
  sourceRecordId?: string
  resultRecordId?: string
  detail: Readonly<Record<string, unknown>>
  completedAt?: number
  durationMs: number
  id: string
  kind: AgentTrajectoryRecordKind
  label: string
  lane: AgentTrajectoryLane
  preview: string
  raw: Readonly<Record<string, unknown>>
  request?: number
  source: string
  startedAt: number
  status: AgentTrajectoryStatus
  summary: string
  turn: number
}

/** 模型与工具节点只能引用实际采集的请求和来源。 */
export type AgentTrajectoryRecord = TrajectoryRecordBase &
  (
    | { kind: 'system' | 'context' | 'user'; lane: 'input' }
    | {
        kind: 'request' | 'assistant'
        lane: 'model'
        request: number
        sourceRecordId: string
      }
    | { kind: 'tool'; lane: 'tools'; request: number; sourceRecordId: string }
  )

export interface AgentTrajectory {
  sessionId: string
  cursor: { sequence: number; revision: number }
  runs: {
    runId: string
    number: number
    startedAt: number
    completedAt?: number
    status: AgentTrajectoryStatus
  }[]
  completedAt?: number
  durationMs: number
  model: string
  records: AgentTrajectoryRecord[]
  requestCount: number
  startedAt: number
  turnCount: number
}

interface RequestStartedData {
  runId: string
  turn: number
  api: string
  modelId: string
  providerId: string
  schemaVersion: 1
  startedAt: number
}

interface RequestCompletedData {
  requestEntryId: string
  firstTokenAt?: number
  completedAt: number
  responseId?: string
  schemaVersion: 1
  status: Exclude<AgentTrajectoryStatus, 'interrupted' | 'running'>
  stopReason: string
  usage: {
    cacheRead: number
    cacheWrite: number
    input: number
    output: number
    total: number
  }
}

interface ToolStartedData {
  schemaVersion: 1
  startedAt: number
  toolCallId: string
  toolName: string
}

interface ToolCompletedData {
  completedAt: number
  isError: boolean
  schemaVersion: 1
  toolCallId: string
  toolName: string
}

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)$/iu
const BEARER_VALUE = /(\bbearer\s+)[a-z0-9._~+/=-]+/giu
const SENSITIVE_VALUE =
  /((?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:bearer\s+)?[^\s,;'"]+)/giu

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const redactTrajectoryText = (value: string) =>
  value
    .replace(SENSITIVE_VALUE, '$1[redacted]')
    .replace(BEARER_VALUE, '$1[redacted]')

const compactText = (value: string, limit = 320) => {
  const text = redactTrajectoryText(value).replace(/\s+/gu, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** 清除轨迹详情中的凭据字段和重复二进制附件。 */
export const redactTrajectoryValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactTrajectoryValue)
  if (typeof value === 'string') return redactTrajectoryText(value)
  if (!isObject(value)) return value

  const hasBinaryMime =
    typeof value.mimeType === 'string' &&
    (typeof value.data === 'string' || typeof value.content === 'string')
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'errorMessage'
        ? '[omitted provider error]'
        : SENSITIVE_KEY.test(key)
          ? '[redacted]'
          : hasBinaryMime && (key === 'data' || key === 'content')
            ? '[omitted binary]'
            : redactTrajectoryValue(child),
    ]),
  )
}

const rawEntry = (entry: Entry) =>
  redactTrajectoryValue(entry) as Readonly<Record<string, unknown>>

/** 必要事实损坏时明确失败，不把旧事件转换成可用记录。 */
const requireFact: (condition: unknown) => asserts condition = (condition) => {
  if (!condition)
    throw new AgentRuntimeError(
      'TRAJECTORY_INVALID_EVENT',
      '会话轨迹事件不符合当前契约。',
      409,
    )
}

const customData = (entry: Entry, customType: string) => {
  if (entry.type !== 'custom' || entry.customType !== customType)
    return undefined
  requireFact(isObject(entry.data))
  return entry.data
}

const userText = (message: UserMessage) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('')

const assistantResultText = (message: AssistantMessage) => {
  const text = message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
  const toolNames = message.content.flatMap((content) =>
    content.type === 'toolCall' ? [content.name] : [],
  )
  return text || (toolNames.length ? `请求调用 ${toolNames.join('、')}` : '')
}

const toolResultText = (message: ToolResultMessage) =>
  message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('')

const requestStartedData = (entry: Entry): RequestStartedData | undefined => {
  const data = customData(entry, SESSION_CUSTOM_TYPE.llmRequestStarted)
  if (!data) return undefined
  requireFact(
    data.schemaVersion === 1 &&
      Number.isFinite(data.startedAt) &&
      typeof data.providerId === 'string' &&
      typeof data.modelId === 'string' &&
      typeof data.api === 'string' &&
      typeof data.runId === 'string' &&
      Number.isSafeInteger(data.turn) &&
      Number(data.turn) > 0,
  )
  return data as unknown as RequestStartedData
}

const requestCompletedData = (
  entry: Entry,
): RequestCompletedData | undefined => {
  const data = customData(entry, SESSION_CUSTOM_TYPE.llmRequestCompleted)
  if (!data) return undefined
  requireFact(
    data.schemaVersion === 1 &&
      Number.isFinite(data.completedAt) &&
      typeof data.stopReason === 'string' &&
      (data.status === 'completed' ||
        data.status === 'failed' ||
        data.status === 'aborted') &&
      typeof data.requestEntryId === 'string' &&
      (data.firstTokenAt === undefined || Number.isFinite(data.firstTokenAt)) &&
      isObject(data.usage) &&
      ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].every(
        (key) =>
          Number.isFinite(
            data.usage && (data.usage as Record<string, unknown>)[key],
          ) && Number((data.usage as Record<string, unknown>)[key]) >= 0,
      ),
  )
  return data as unknown as RequestCompletedData
}

const toolStartedData = (entry: Entry): ToolStartedData | undefined => {
  const data = customData(entry, SESSION_CUSTOM_TYPE.toolExecutionStarted)
  if (!data) return undefined
  requireFact(
    data.schemaVersion === 1 &&
      Number.isFinite(data.startedAt) &&
      typeof data.toolCallId === 'string' &&
      typeof data.toolName === 'string',
  )
  return data as unknown as ToolStartedData
}

const toolCompletedData = (entry: Entry): ToolCompletedData | undefined => {
  const data = customData(entry, SESSION_CUSTOM_TYPE.toolExecutionCompleted)
  if (!data) return undefined
  requireFact(
    data.schemaVersion === 1 &&
      Number.isFinite(data.completedAt) &&
      typeof data.isError === 'boolean' &&
      typeof data.toolCallId === 'string' &&
      typeof data.toolName === 'string',
  )
  return data as unknown as ToolCompletedData
}

const messageStatus = (
  message: AssistantMessage,
): Exclude<AgentTrajectoryStatus, 'interrupted' | 'running'> =>
  message.stopReason === 'error'
    ? 'failed'
    : message.stopReason === 'aborted'
      ? 'aborted'
      : 'completed'

/** 将 Pi JSONL 主分支投影为可恢复的产品轨迹。 */
export const projectAgentTrajectory = (options: {
  active: boolean
  entries: readonly Entry[]
  model: string
  now?: number
  sessionId: string
}): AgentTrajectory => {
  const now = options.now ?? Date.now()
  const entries = [...options.entries].sort(
    (left, right) => left.seq - right.seq,
  )
  const runs: AgentTrajectory['runs'] = []
  const toolCalls = new Map<
    string,
    {
      entry: Extract<Entry, { type: 'message' }>
      request: number
      sourceRecordId: string
      toolCall: Extract<
        AssistantMessage['content'][number],
        { type: 'toolCall' }
      >
      turn: number
    }
  >()
  const toolResults = new Map<string, Extract<Entry, { type: 'message' }>>()
  let scanTurn = 0
  let scanRequest = 0
  let scanRequestId = ''

  for (const entry of entries) {
    if (entry.type === 'message') {
      const message = entry.message
      if (message.role === 'assistant') {
        for (const content of message.content) {
          if (content.type === 'toolCall') {
            toolCalls.set(content.id, {
              entry,
              request: scanRequest,
              sourceRecordId: scanRequestId,
              toolCall: content,
              turn: scanTurn,
            })
          }
        }
      } else if (message.role === 'toolResult') {
        toolResults.set(message.toolCallId, entry)
      }
      continue
    }
    if (customData(entry, SESSION_CUSTOM_TYPE.runStarted)) {
      scanTurn = 0
    }
    const turnStart = customData(entry, SESSION_CUSTOM_TYPE.turnStarted)
    if (typeof turnStart?.turn === 'number') scanTurn = turnStart.turn
    if (requestStartedData(entry)) {
      scanRequest += 1
      scanRequestId = entry.id
    }
  }

  const records: AgentTrajectoryRecord[] = []
  const toolRecordByCall = new Map<string, number>()
  let currentTurn = 0
  let currentRequest = 0
  let openRequestIndex: number | undefined
  let currentRun: AgentTrajectory['runs'][number] | undefined
  let header: Record<string, unknown> | undefined
  let lastSystemId: string | undefined
  let totalTurns = 0
  const addRecord = (
    record: Omit<
      AgentTrajectoryRecord,
      'runId' | 'runNumber' | 'position' | 'detail'
    > & { detail?: Readonly<Record<string, unknown>> },
  ) => {
    requireFact(currentRun)
    if (record.lane !== 'input')
      requireFact(record.turn > 0 && record.request && record.sourceRecordId)
    records.push({
      ...record,
      detail: redactTrajectoryValue(record.detail ?? {}) as Readonly<
        Record<string, unknown>
      >,
      runId: currentRun.runId,
      runNumber: currentRun.number,
      position: records.length,
    } as AgentTrajectoryRecord)
  }

  for (const entry of entries) {
    const runStart = customData(entry, SESSION_CUSTOM_TYPE.runStarted)
    if (runStart) {
      requireFact(
        typeof runStart.runId === 'string' &&
          runStart.runId.length > 0 &&
          !runs.some((run) => run.runId === runStart.runId),
      )
      openRequestIndex = undefined
      currentRun = {
        runId: runStart.runId,
        number: runs.length + 1,
        startedAt: entry.timestamp,
        status: options.active ? 'running' : 'interrupted',
      }
      runs.push(currentRun)
      currentTurn = 0
      continue
    }
    const runEnd = customData(entry, SESSION_CUSTOM_TYPE.runCompleted)
    if (runEnd) {
      requireFact(
        currentRun &&
          currentRun.runId === runEnd.runId &&
          ['completed', 'failed', 'aborted'].includes(String(runEnd.status)),
      )
      currentRun.completedAt = entry.timestamp
      currentRun.status =
        runEnd.status === 'completed'
          ? 'completed'
          : runEnd.status === 'aborted'
            ? 'aborted'
            : 'failed'
      continue
    }
    const turnStart = customData(entry, SESSION_CUSTOM_TYPE.turnStarted)
    if (turnStart) {
      requireFact(
        currentRun &&
          turnStart.runId === currentRun.runId &&
          turnStart.turn === currentTurn + 1,
      )
      currentTurn = Number(turnStart.turn)
      totalTurns += 1
      continue
    }
    const turnEnd = customData(entry, SESSION_CUSTOM_TYPE.turnCompleted)
    if (turnEnd) {
      requireFact(
        currentRun &&
          turnEnd.runId === currentRun.runId &&
          turnEnd.turn === currentTurn &&
          currentTurn > 0,
      )
      continue
    }
    const nextHeader = customData(entry, SESSION_CUSTOM_TYPE.llmRequestHeader)
    if (nextHeader) {
      requireFact(
        typeof nextHeader.system === 'string' &&
          Array.isArray(nextHeader.tools) &&
          isObject(nextHeader.config),
      )
      requireFact(currentRun && currentTurn > 0)
      const previous = header
      header = nextHeader
      const systemChanged = previous?.system !== header.system
      const toolsChanged =
        JSON.stringify(previous?.tools) !== JSON.stringify(header.tools)
      if (!previous || systemChanged || toolsChanged) {
        lastSystemId = entry.id
        addRecord({
          id: entry.id,
          kind: 'system',
          lane: 'input',
          label: previous
            ? systemChanged && toolsChanged
              ? 'System Prompt and Tools Updated'
              : systemChanged
                ? 'System Prompt Updated'
                : 'Tools Updated'
            : 'Initial System Prompt',
          preview: redactTrajectoryText(String(header.system)),
          raw: rawEntry(entry),
          source: 'LLM · Effective Request Header',
          startedAt: entry.timestamp,
          durationMs: 0,
          status: 'completed',
          summary: previous
            ? '请求使用的系统提示或工具定义已更新。'
            : 'Initial System Prompt',
          detail: redactTrajectoryValue({
            ...header,
            ...(previous ? { previous } : {}),
          }) as Record<string, unknown>,
          turn: previous ? currentTurn : 0,
        })
      }
      continue
    }
    if (entry.type === 'message') {
      const message = entry.message
      if (
        message.role === 'custom' &&
        message.customType === SESSION_CUSTOM_TYPE.agentContext
      ) {
        requireFact(
          isObject(message.details) &&
            typeof message.details.source === 'string',
        )
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content)
        addRecord({
          id: entry.id,
          kind: 'context',
          lane: 'input',
          label: '上下文',
          preview: redactTrajectoryText(content),
          summary: compactText(content),
          raw: rawEntry(entry),
          source: `Context · ${message.details.source}`,
          startedAt: entry.timestamp,
          durationMs: 0,
          status: 'completed',
          turn: openRequestIndex === undefined ? 0 : currentTurn,
        })
        continue
      }
      if (
        message.role === 'custom' &&
        message.customType === SESSION_CUSTOM_TYPE.userInput
      ) {
        const details = structuredMessageDetails(message.details)
        requireFact(details)
        addRecord({
          durationMs: 0,
          id: entry.id,
          kind: 'user',
          label: '用户消息',
          lane: 'input',
          preview: redactTrajectoryText(details.content),
          raw: rawEntry(entry),
          source: 'Conversation · User Message',
          startedAt: entry.timestamp,
          status: 'completed',
          summary: compactText(details.content),
          turn: 0,
        })
        continue
      }
      if (message.role === 'user') {
        addRecord({
          durationMs: 0,
          id: entry.id,
          kind: 'user',
          label: '用户消息',
          lane: 'input',
          preview: redactTrajectoryText(userText(message)),
          raw: rawEntry(entry),
          source: 'Conversation · User Message',
          startedAt: entry.timestamp,
          status: 'completed',
          summary: compactText(userText(message)),
          turn: 0,
        })
        continue
      }
      if (message.role === 'assistant') {
        const preview = redactTrajectoryText(assistantResultText(message))
        const requestRecord =
          openRequestIndex === undefined ? undefined : records[openRequestIndex]
        requireFact(requestRecord?.kind === 'request')
        const assistantId = `${requestRecord.id}:assistant`
        requestRecord.resultRecordId = assistantId
        requestRecord.detail = {
          ...requestRecord.detail,
          toolCalls: message.content.filter(
            (block) => block.type === 'toolCall',
          ).length,
        }
        addRecord({
          durationMs: Math.max(0, entry.timestamp - requestRecord.startedAt),
          id: assistantId,
          sourceRecordId: requestRecord.id,
          detail: {
            blocks: redactTrajectoryValue(message.content),
            usage: redactTrajectoryValue(message.usage),
          },
          kind: 'assistant',
          label: message.content.some((content) => content.type === 'thinking')
            ? 'Assistant 推理与响应'
            : 'Assistant 响应',
          lane: 'model',
          preview,
          raw: rawEntry(entry),
          request: currentRequest,
          source: `Model · ${message.provider}/${message.model}`,
          startedAt: requestRecord.startedAt,
          completedAt: entry.timestamp,
          status: messageStatus(message),
          summary: compactText(assistantResultText(message)),
          turn: currentTurn,
        })
      }
      continue
    }

    const started = requestStartedData(entry)
    if (started) {
      requireFact(
        currentRun &&
          currentRun.runId === started.runId &&
          currentTurn === started.turn &&
          header &&
          lastSystemId &&
          openRequestIndex === undefined,
      )
      currentRequest += 1
      openRequestIndex = records.length
      addRecord({
        durationMs: Math.max(0, now - started.startedAt),
        id: entry.id,
        sourceRecordId: lastSystemId,
        detail: {
          options: header.config,
          system: header.system,
          tools: header.tools,
        },
        kind: 'request',
        label: `Request #${currentRequest}`,
        lane: 'model',
        preview: `${started.providerId} / ${started.modelId}`,
        raw: { started: rawEntry(entry) },
        request: currentRequest,
        source: `Provider · ${started.providerId}`,
        startedAt: started.startedAt,
        status: options.active ? 'running' : 'interrupted',
        summary: '一次逻辑 LLM 请求正在执行。',
        turn: currentTurn,
      })
      continue
    }

    const completed = requestCompletedData(entry)
    if (completed) {
      requireFact(openRequestIndex !== undefined)
      const record = records[openRequestIndex]
      requireFact(
        record?.kind === 'request' && record.id === completed.requestEntryId,
      )
      {
        records[openRequestIndex] = {
          ...record,
          completedAt: completed.completedAt,
          durationMs: Math.max(0, completed.completedAt - record.startedAt),
          raw: { ...record.raw, completed: rawEntry(entry) },
          status: completed.status,
          detail: {
            ...record.detail,
            usage: completed.usage,
            timing: {
              startedAt: record.startedAt,
              completedAt: completed.completedAt,
              ...(completed.firstTokenAt === undefined
                ? {}
                : { firstTokenAt: completed.firstTokenAt }),
            },
          },
          summary: `LLM 请求${completed.status === 'completed' ? '完成' : completed.status === 'aborted' ? '已中止' : '失败'}，输入 ${completed.usage.input} Token，输出 ${completed.usage.output} Token。`,
        }
        const assistant = records.find(
          (item) =>
            item.sourceRecordId === record.id && item.kind === 'assistant',
        )
        if (assistant)
          assistant.detail = {
            ...assistant.detail,
            timing: records[openRequestIndex]?.detail?.timing,
          }
      }
      openRequestIndex = undefined
      continue
    }

    const toolStarted = toolStartedData(entry)
    if (toolStarted) {
      const call = toolCalls.get(toolStarted.toolCallId)
      requireFact(
        call &&
          call.request > 0 &&
          call.turn === currentTurn &&
          call.toolCall.name === toolStarted.toolName &&
          !toolRecordByCall.has(toolStarted.toolCallId),
      )
      const result = toolResults.get(toolStarted.toolCallId)
      toolRecordByCall.set(toolStarted.toolCallId, records.length)
      addRecord({
        durationMs: Math.max(0, now - toolStarted.startedAt),
        id: `tool:${toolStarted.toolCallId}`,
        kind: 'tool',
        detail: {
          input: redactTrajectoryValue(call.toolCall.arguments),
          output:
            result?.message.role === 'toolResult'
              ? redactTrajectoryValue(result.message.content)
              : undefined,
        },
        label: toolStarted.toolName,
        lane: 'tools',
        preview: redactTrajectoryText(JSON.stringify(call.toolCall.arguments)),
        raw: {
          call: rawEntry(call.entry),
          started: rawEntry(entry),
          ...(result ? { result: rawEntry(result) } : {}),
        },
        request: call.request,
        sourceRecordId: call.sourceRecordId,
        source: `Agent Runtime · Tool ${toolStarted.toolName}`,
        startedAt: toolStarted.startedAt,
        status: options.active ? 'running' : 'interrupted',
        summary: compactText(JSON.stringify(call.toolCall.arguments)),
        turn: call.turn,
      })
      continue
    }

    const toolCompleted = toolCompletedData(entry)
    const toolIndex = toolCompleted
      ? toolRecordByCall.get(toolCompleted.toolCallId)
      : undefined
    if (toolCompleted) {
      requireFact(toolIndex !== undefined)
      const record = records[toolIndex]
      requireFact(
        record?.kind === 'tool' && record.label === toolCompleted.toolName,
      )
      const result = toolResults.get(toolCompleted.toolCallId)
      // Pi 先发 tool_execution_end，再发 Tool Result 的 message_end。
      // 这是实时持久化边界，不是旧数据兼容；下一次投影补上已落库正文。
      requireFact(
        !result ||
          (result.message.role === 'toolResult' &&
            result.message.toolName === toolCompleted.toolName),
      )
      const output =
        result?.message.role === 'toolResult'
          ? toolResultText(result.message)
          : undefined
      records[toolIndex] = {
        ...record,
        completedAt: toolCompleted.completedAt,
        durationMs: Math.max(0, toolCompleted.completedAt - record.startedAt),
        raw: { ...record.raw, completed: rawEntry(entry) },
        status: toolCompleted.isError ? 'failed' : 'completed',
        preview:
          output === undefined ? record.preview : redactTrajectoryText(output),
        summary: compactText(
          `${record.summary} → ${output ?? '等待结果落库。'}`,
        ),
      }
      continue
    }

    if (entry.type === 'compaction') {
      addRecord({
        durationMs: 0,
        id: entry.id,
        kind: 'context',
        label: '上下文压缩',
        lane: 'input',
        preview: redactTrajectoryText(entry.summary),
        raw: rawEntry(entry),
        source: 'Pi Session · Compaction',
        startedAt: entry.timestamp,
        status: 'completed',
        summary: `压缩前上下文约 ${entry.tokensBefore} Token。`,
        turn: currentTurn,
      })
    }
  }

  for (const run of runs) {
    if (run.status === 'running' && run !== runs.at(-1))
      run.status = 'interrupted'
  }
  for (const record of records) {
    const run = runs[record.runNumber - 1]
    requireFact(run)
    if (
      (record.status === 'running' || record.status === 'interrupted') &&
      run.status !== 'running'
    ) {
      record.status =
        run.status === 'aborted'
          ? 'aborted'
          : run.status === 'failed'
            ? 'failed'
            : 'interrupted'
      record.durationMs = Math.max(
        0,
        (run.completedAt ?? record.startedAt) - record.startedAt,
      )
      if (run.completedAt !== undefined) record.completedAt = run.completedAt
      record.summary = `执行${record.status === 'failed' ? '失败' : record.status === 'aborted' ? '已中止' : '中断'}，未收到完整结果。`
    }
  }
  const initialSystemIndex = records.findIndex(
    (record) => record.kind === 'system' && record.turn === 0,
  )
  if (initialSystemIndex > 0) {
    const [initialSystem] = records.splice(initialSystemIndex, 1)
    if (initialSystem) records.unshift(initialSystem)
  }

  const startedAt = records.reduce(
    (earliest, record) => Math.min(earliest, record.startedAt),
    entries[0]?.timestamp ?? now,
  )
  const latestAt = records.reduce(
    (latest, record) =>
      Math.max(
        latest,
        record.completedAt ?? record.startedAt + record.durationMs,
      ),
    startedAt,
  )
  const hasActiveRecord =
    runs.some((run) => run.status === 'running') ||
    records.some((record) => record.status === 'running')
  records.forEach((record, position) => {
    record.position = position
  })
  return {
    ...(hasActiveRecord ? {} : { completedAt: latestAt }),
    durationMs: Math.max(0, latestAt - startedAt),
    model: options.model,
    records,
    requestCount: records.filter((record) => record.kind === 'request').length,
    sessionId: options.sessionId,
    cursor: { sequence: entries.at(-1)?.seq ?? 0, revision: 0 },
    runs,
    startedAt,
    turnCount: totalTurns,
  }
}
