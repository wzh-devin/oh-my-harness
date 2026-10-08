import type { Entry } from '@earendil-works/pi-agent-core'
import { SESSION_CUSTOM_TYPE } from '@oh-my-harness/shared'

export interface RequestCostProjection {
  completedAt: number
  costTotal: number
  requestId: string
  sessionId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** 从当前 JSONL 请求完成事实生成每日预算所需的最小成本投影。 */
export const projectRequestCosts = (
  entries: Entry[],
  sessionId: string,
): RequestCostProjection[] => {
  const costs = new Map<string, RequestCostProjection>()

  for (const entry of entries) {
    if (
      entry.type !== 'custom' ||
      entry.customType !== SESSION_CUSTOM_TYPE.LLM_REQUEST_COMPLETED
    ) {
      continue
    }
    if (!isRecord(entry.data) || !isRecord(entry.data.usage)) {
      throw new Error('LLM request completion entry is invalid')
    }

    const { completedAt, requestEntryId, schemaVersion, usage } = entry.data
    const costTotal = usage.costTotal
    if (
      schemaVersion !== 1 ||
      typeof requestEntryId !== 'string' ||
      !requestEntryId ||
      !Number.isSafeInteger(completedAt) ||
      Number(completedAt) < 0 ||
      typeof costTotal !== 'number' ||
      !Number.isFinite(costTotal) ||
      costTotal < 0
    ) {
      throw new Error('LLM request completion entry is invalid')
    }

    costs.set(requestEntryId, {
      completedAt: Number(completedAt),
      costTotal,
      requestId: requestEntryId,
      sessionId,
    })
  }

  return [...costs.values()]
}
