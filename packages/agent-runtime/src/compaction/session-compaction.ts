import {
  buildSessionContext,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
  type AgentMessage,
  type CompactionEntry,
  type Entry,
  type ProvisionedEntry,
  type Session,
} from '@earendil-works/pi-agent-core'
import type { Api, Model, Models } from '@earendil-works/pi-ai'

import { AgentRuntimeError } from '../error/agent-runtime-error.ts'
import type { AgentSessionMetadata } from '../session/session-service.ts'

function contextNeedsCompaction(
  entries: Entry[],
  incoming: AgentMessage | undefined,
  contextWindow: number,
) {
  const messages = buildSessionContext(entries).messages
  if (incoming) messages.push(incoming)
  return shouldCompact(
    estimateContextTokens(messages).tokens,
    contextWindow,
    DEFAULT_COMPACTION_SETTINGS,
  )
}

/** 只使用 Pi 原生 compaction entry 收敛下一次请求上下文。 */
export async function compactSessionIfNeeded(options: {
  entries: Entry[]
  incoming?: AgentMessage
  model: Model<Api>
  models: Models
  session: Session<AgentSessionMetadata>
  signal: AbortSignal
}) {
  if (
    !contextNeedsCompaction(
      options.entries,
      options.incoming,
      options.model.contextWindow,
    )
  ) {
    return options.entries
  }

  const preparation = prepareCompaction(
    options.entries,
    DEFAULT_COMPACTION_SETTINGS,
  )
  if (!preparation.ok || !preparation.value) {
    throw new AgentRuntimeError(
      'CONTEXT_TOO_LARGE',
      '当前消息超过模型上下文限制。',
      413,
    )
  }

  const result = await compact(
    preparation.value,
    options.models,
    options.model,
    undefined,
    options.signal,
  )
  if (!result.ok) {
    if (result.error.code === 'aborted') {
      throw new AgentRuntimeError('AGENT_RUN_ABORTED', '运行已终止。', 409)
    }
    throw new AgentRuntimeError(
      'AGENT_COMPACTION_FAILED',
      '会话上下文压缩失败。',
      500,
    )
  }

  const entry = {
    id: options.session.idGenerator.next(),
    retainedTail: result.value.retainedTail,
    summary: result.value.summary,
    tokensBefore: result.value.tokensBefore,
    type: 'compaction',
    ...(result.value.details === undefined
      ? {}
      : { details: result.value.details }),
    ...(result.value.usage === undefined ? {} : { usage: result.value.usage }),
  } satisfies ProvisionedEntry<CompactionEntry>
  await options.session.appendEntry(entry, 'main')

  const entries = await options.session.findEntriesOnBranch({
    order: 'oldestFirst',
  })
  if (
    contextNeedsCompaction(
      entries,
      options.incoming,
      options.model.contextWindow,
    )
  ) {
    throw new AgentRuntimeError(
      'CONTEXT_TOO_LARGE',
      '当前消息超过模型上下文限制。',
      413,
    )
  }
  return entries
}
