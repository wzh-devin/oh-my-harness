import { type AgentState } from '@earendil-works/pi-agent-core'
import { requestTokenParts } from '../compaction/context-view.ts'

export interface ContextUsageSnapshot {
  contextWindow: number
  inputLimit?: number
  messageTokens: number
  modelId: string
  providerId: string
  systemTokens: number
  toolsTokens: number
  usedTokens: number
}

interface PersistedContextUsageSnapshot extends ContextUsageSnapshot {
  inputLimit: number
  schemaVersion: 4
}

const tokenFields = [
  'contextWindow',
  'messageTokens',
  'systemTokens',
  'toolsTokens',
  'usedTokens',
] as const

/** 估算下一轮请求的稳定上下文规模及模型可见组成。 */
export const calculateContextUsage = (
  state: Pick<AgentState, 'messages' | 'model' | 'systemPrompt' | 'tools'>,
  inputLimit: number,
): ContextUsageSnapshot & { inputLimit: number } => {
  return {
    contextWindow: state.model.contextWindow,
    inputLimit,
    modelId: state.model.id,
    providerId: state.model.provider,
    ...requestTokenParts(state),
  }
}

/** 恢复上次运行的合法快照，选择其他模型不会让已发生的上下文失效。 */
export const parseContextUsageSnapshot = (
  value: unknown,
): ContextUsageSnapshot | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const snapshot = value as Record<string, unknown>
  if (
    (snapshot.schemaVersion !== 3 && snapshot.schemaVersion !== 4) ||
    typeof snapshot.modelId !== 'string' ||
    !snapshot.modelId.trim() ||
    typeof snapshot.providerId !== 'string' ||
    !snapshot.providerId.trim() ||
    !tokenFields.every(
      (field) =>
        Number.isSafeInteger(snapshot[field]) &&
        (snapshot[field] as number) >= (field === 'contextWindow' ? 1 : 0),
    ) ||
    (snapshot.schemaVersion === 4 &&
      (!Number.isSafeInteger(snapshot.inputLimit) ||
        (snapshot.inputLimit as number) < 0))
  ) {
    return
  }
  const { schemaVersion, ...result } = snapshot
  return schemaVersion === 4
    ? (result as unknown as ContextUsageSnapshot)
    : (Object.fromEntries(
        Object.entries(result).filter(([key]) => key !== 'inputLimit'),
      ) as unknown as ContextUsageSnapshot)
}

export const persistedContextUsageSnapshot = (
  snapshot: ContextUsageSnapshot & { inputLimit: number },
): PersistedContextUsageSnapshot => ({ ...snapshot, schemaVersion: 4 })
