import {
  estimateContextTokens,
  estimateTokens,
  type AgentMessage,
  type AgentState,
} from '@earendil-works/pi-agent-core'
import { MESSAGE_ROLE } from '@oh-my-harness/shared'

export interface ContextUsageSnapshot {
  contextWindow: number
  messageTokens: number
  modelId: string
  providerId: string
  systemTokens: number
  toolsTokens: number
  usedTokens: number
}

interface PersistedContextUsageSnapshot extends ContextUsageSnapshot {
  schemaVersion: 1
}

const tokenFields = [
  'contextWindow',
  'messageTokens',
  'systemTokens',
  'toolsTokens',
  'usedTokens',
] as const

const textMessage = (content: string): AgentMessage => ({
  content,
  role: MESSAGE_ROLE.USER,
  timestamp: 0,
})

/** 估算下一轮请求的稳定上下文规模及模型可见组成。 */
export const calculateContextUsage = (
  state: Pick<AgentState, 'messages' | 'model' | 'systemPrompt' | 'tools'>,
): ContextUsageSnapshot => {
  const visibleTools = state.tools.map(
    ({ constrainedSampling, description, name, parameters }) => ({
      ...(constrainedSampling === undefined ? {} : { constrainedSampling }),
      description,
      name,
      parameters,
    }),
  )
  return {
    contextWindow: state.model.contextWindow,
    messageTokens: state.messages.reduce(
      (total, message) => total + estimateTokens(message),
      0,
    ),
    modelId: state.model.id,
    providerId: state.model.provider,
    systemTokens: estimateTokens(textMessage(state.systemPrompt)),
    toolsTokens: estimateTokens(textMessage(JSON.stringify(visibleTools))),
    usedTokens: estimateContextTokens(state.messages).tokens,
  }
}

/** 在 JSONL 边界校验快照，非法版本或模型不匹配时忽略。 */
export const parseContextUsageSnapshot = (
  value: unknown,
  model: Pick<ContextUsageSnapshot, 'modelId' | 'providerId'>,
): ContextUsageSnapshot | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const snapshot = value as Record<string, unknown>
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.modelId !== model.modelId ||
    snapshot.providerId !== model.providerId ||
    !tokenFields.every(
      (field) =>
        Number.isSafeInteger(snapshot[field]) &&
        (snapshot[field] as number) >= (field === 'contextWindow' ? 1 : 0),
    )
  ) {
    return
  }
  const { schemaVersion: _schemaVersion, ...result } =
    snapshot as unknown as PersistedContextUsageSnapshot
  return result
}

export const persistedContextUsageSnapshot = (
  snapshot: ContextUsageSnapshot,
): PersistedContextUsageSnapshot => ({ ...snapshot, schemaVersion: 1 })
