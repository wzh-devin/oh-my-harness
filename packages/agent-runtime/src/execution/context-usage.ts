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
  schemaVersion: 3
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

/** 恢复上次运行的合法快照，选择其他模型不会让已发生的上下文失效。 */
export const parseContextUsageSnapshot = (
  value: unknown,
): ContextUsageSnapshot | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const snapshot = value as Record<string, unknown>
  if (
    snapshot.schemaVersion !== 3 ||
    typeof snapshot.modelId !== 'string' ||
    !snapshot.modelId.trim() ||
    typeof snapshot.providerId !== 'string' ||
    !snapshot.providerId.trim() ||
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
): PersistedContextUsageSnapshot => ({ ...snapshot, schemaVersion: 3 })
