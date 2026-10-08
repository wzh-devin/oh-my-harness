import type { Entry } from '@earendil-works/pi-agent-core'
import {
  RUN_RECOVERY_ACTION,
  RUN_STATUS,
  SESSION_CUSTOM_TYPE,
  type RunStatus,
} from '@oh-my-harness/shared'
import {
  addTokenUsage,
  emptyTokenUsage,
  type AgentRunSummary,
} from '@oh-my-harness/agent-runtime'

type RunData = Record<string, unknown>

interface RunAccumulator {
  completedAt?: number
  completedRequests: Set<string>
  errorCode?: string
  errorMessage?: string
  lastAssistantMessageId?: string
  modelId: string
  permission?: string
  providerId: string
  runId: string
  startedAt: number
  status: RunStatus
  tokenUsage: ReturnType<typeof emptyTokenUsage>
  updatedAt: number
}

const isRecord = (value: unknown): value is RunData =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const eventData = (entry: Entry, customType: string) =>
  entry.type === 'custom' &&
  entry.customType === customType &&
  isRecord(entry.data)
    ? entry.data
    : undefined

const usageValue = (usage: RunData, key: string) =>
  Math.max(0, finite(usage[key], 0))

const addUsage = (
  target: ReturnType<typeof emptyTokenUsage>,
  value: unknown,
) => {
  if (!isRecord(value)) return false
  const cost = isRecord(value.cost) ? value.cost : value
  const usage = {
    cacheRead: usageValue(value, 'cacheRead'),
    cacheWrite: usageValue(value, 'cacheWrite'),
    input: usageValue(value, 'input'),
    output: usageValue(value, 'output'),
    totalTokens: usageValue(value, 'total'),
    cost: {
      cacheRead:
        usageValue(value, 'costCacheRead') || usageValue(cost, 'cacheRead'),
      cacheWrite:
        usageValue(value, 'costCacheWrite') || usageValue(cost, 'cacheWrite'),
      input: usageValue(value, 'costInput') || usageValue(cost, 'input'),
      output: usageValue(value, 'costOutput') || usageValue(cost, 'output'),
      total: usageValue(value, 'costTotal') || usageValue(cost, 'total'),
    },
  }
  addTokenUsage(target, usage)
  return usage.totalTokens > 0 || usage.cost.total > 0
}

const statusOf = (value: unknown): RunStatus | undefined =>
  value === RUN_STATUS.ABORTED ||
  value === RUN_STATUS.COMPLETED ||
  value === RUN_STATUS.FAILED ||
  value === RUN_STATUS.INTERRUPTED ||
  value === RUN_STATUS.RUNNING
    ? value
    : undefined

const recoveryAction = (status: RunStatus) => {
  if (status === RUN_STATUS.INTERRUPTED) return RUN_RECOVERY_ACTION.CONTINUE
  if (status === RUN_STATUS.FAILED) return RUN_RECOVERY_ACTION.RETRY
  return undefined
}

const createAccumulator = (
  runId: string,
  startedAt: number,
  providerId: string,
  modelId: string,
): RunAccumulator => ({
  completedRequests: new Set(),
  modelId,
  providerId,
  runId,
  startedAt,
  status: RUN_STATUS.RUNNING,
  tokenUsage: emptyTokenUsage(),
  updatedAt: startedAt,
})

/** 从 JSONL 当前事实源生成不含正文的 Run 摘要。 */
export const projectRuns = (
  entries: Entry[],
  sessionId: string,
  fallback: { modelId: string; providerId: string },
): AgentRunSummary[] => {
  const runs = new Map<string, RunAccumulator>()
  let activeRunId: string | undefined
  let latestModel = fallback

  const getRun = (runId: string, timestamp: number) => {
    const existing = runs.get(runId)
    if (existing) return existing
    const created = createAccumulator(
      runId,
      timestamp,
      latestModel.providerId,
      latestModel.modelId,
    )
    runs.set(runId, created)
    return created
  }

  for (const item of entries) {
    const timestamp = item.timestamp
    if (item.type === 'model_change') {
      const modelChange = item as unknown as {
        provider?: unknown
        modelId?: unknown
      }
      if (
        typeof modelChange.provider === 'string' &&
        typeof modelChange.modelId === 'string'
      ) {
        latestModel = {
          modelId: modelChange.modelId,
          providerId: modelChange.provider,
        }
      }
      continue
    }
    const started = eventData(item, SESSION_CUSTOM_TYPE.RUN_STARTED)
    if (started) {
      if (typeof started.runId !== 'string') continue
      const run = getRun(started.runId, finite(started.startedAt, timestamp))
      activeRunId = run.runId
      run.startedAt = finite(started.startedAt, timestamp)
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      if (typeof started.providerId === 'string')
        run.providerId = started.providerId
      if (typeof started.modelId === 'string') run.modelId = started.modelId
      continue
    }
    const policy = eventData(item, SESSION_CUSTOM_TYPE.RUN_POLICY)
    if (policy && typeof policy.runId === 'string') {
      const run = getRun(policy.runId, timestamp)
      activeRunId = run.runId
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      if (typeof policy.permission === 'string')
        run.permission = policy.permission
      continue
    }
    const requestStarted = eventData(
      item,
      SESSION_CUSTOM_TYPE.LLM_REQUEST_STARTED,
    )
    if (requestStarted && typeof requestStarted.runId === 'string') {
      const run = getRun(requestStarted.runId, timestamp)
      activeRunId = run.runId
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      if (typeof requestStarted.providerId === 'string')
        run.providerId = requestStarted.providerId
      if (typeof requestStarted.modelId === 'string')
        run.modelId = requestStarted.modelId
      continue
    }
    const requestCompleted = eventData(
      item,
      SESSION_CUSTOM_TYPE.LLM_REQUEST_COMPLETED,
    )
    if (requestCompleted) {
      const run = getRun(
        typeof requestCompleted.runId === 'string'
          ? requestCompleted.runId
          : (activeRunId ?? `legacy-${item.id}`),
        timestamp,
      )
      activeRunId = run.runId
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      if (typeof requestCompleted.requestEntryId === 'string') {
        if (run.completedRequests.has(requestCompleted.requestEntryId)) continue
        run.completedRequests.add(requestCompleted.requestEntryId)
      }
      addUsage(run.tokenUsage, requestCompleted.usage)
      continue
    }
    const completed = eventData(item, SESSION_CUSTOM_TYPE.RUN_COMPLETED)
    if (completed && typeof completed.runId === 'string') {
      const run = getRun(completed.runId, timestamp)
      activeRunId = run.runId
      run.completedAt = finite(completed.completedAt, timestamp)
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      run.status = statusOf(completed.status) ?? RUN_STATUS.FAILED
      if (typeof completed.errorCode === 'string')
        run.errorCode = completed.errorCode.slice(0, 128)
      if (typeof completed.errorMessage === 'string')
        run.errorMessage = completed.errorMessage.slice(0, 500)
      continue
    }
    if (item.type !== 'message') continue
    if (item.message.role === 'assistant' && activeRunId) {
      const run = getRun(activeRunId, timestamp)
      run.lastAssistantMessageId = item.id
      run.updatedAt = Math.max(run.updatedAt, timestamp)
      if (!run.completedRequests.size)
        addUsage(run.tokenUsage, item.message.usage)
    }
  }

  return [...runs.values()]
    .map((run) => {
      const status =
        run.completedAt === undefined ? RUN_STATUS.INTERRUPTED : run.status
      return {
        ...(run.completedAt === undefined
          ? {}
          : { completedAt: run.completedAt }),
        cost: run.tokenUsage.cost,
        ...(run.errorCode ? { errorCode: run.errorCode } : {}),
        ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
        ...(run.lastAssistantMessageId
          ? { lastAssistantMessageId: run.lastAssistantMessageId }
          : {}),
        modelId: run.modelId,
        ...(run.permission ? { permission: run.permission } : {}),
        providerId: run.providerId,
        ...(recoveryAction(status)
          ? { recoveryAction: recoveryAction(status) }
          : {}),
        runId: run.runId,
        sessionId,
        startedAt: run.startedAt,
        status,
        tokenUsage: run.tokenUsage,
        updatedAt: run.updatedAt,
      }
    })
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.runId.localeCompare(left.runId),
    )
}
