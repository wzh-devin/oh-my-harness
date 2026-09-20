import {
  createCustomMessage,
  estimateTokens,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import type { Api, Model, Tool } from '@earendil-works/pi-ai'
import { BUILTIN_TOOL_NAME, MESSAGE_ROLE } from '@oh-my-harness/shared'
import type { TodoItem } from '@oh-my-harness/agent-tools'

import { AgentRuntimeError } from '../error/agent-runtime-error.ts'
import { buildCurrentTodosPrompt } from '../prompt/system-prompt.ts'
import { SESSION_CUSTOM_TYPE } from '../session/session-custom-type.ts'

type RequestContext = {
  messages: readonly AgentMessage[]
  systemPrompt?: string
  tools?: readonly Tool[]
}

export const contextBudget = (model: Model<Api>) => {
  const outputTokens = Math.max(
    1,
    Math.min(model.maxTokens, 16_384, Math.floor(model.contextWindow / 4)),
  )
  const safetyTokens = Math.min(4096, Math.ceil(model.contextWindow / 16))
  const inputTokens = Math.max(
    0,
    model.contextWindow - outputTokens - safetyTokens,
  )
  return {
    outputTokens,
    inputTokens,
    toolResultChars: Math.max(1024, Math.min(16_000, inputTokens)),
  }
}

/** 重新估算当前视图，历史 usage 不能用于已经裁剪或换模型的消息前缀。 */
export const requestTokenParts = (context: RequestContext) => {
  const textTokens = (content: string) =>
    estimateTokens({ role: MESSAGE_ROLE.USER, content, timestamp: 0 })
  const messageTokens = context.messages.reduce(
    (total, message) => total + estimateTokens(message) + 16,
    0,
  )
  const systemTokens = textTokens(context.systemPrompt ?? '')
  const toolsTokens = context.tools?.length
    ? textTokens(
        JSON.stringify(
          context.tools.map(
            ({ constrainedSampling, description, name, parameters }) => ({
              ...(constrainedSampling === undefined
                ? {}
                : { constrainedSampling }),
              description,
              name,
              parameters,
            }),
          ),
        ),
      )
    : 0
  return {
    messageTokens,
    systemTokens,
    toolsTokens,
    usedTokens: messageTokens + systemTokens + toolsTokens,
  }
}

export const assertContextFits = (
  context: RequestContext,
  model: Model<Api>,
) => {
  if (requestTokenParts(context).usedTokens > contextBudget(model).inputTokens)
    throw new AgentRuntimeError(
      'CONTEXT_TOO_LARGE',
      '当前消息超过模型上下文限制。',
      413,
    )
}

export const isTaskMessage = (message: AgentMessage) =>
  message.role === MESSAGE_ROLE.USER ||
  (message.role === 'custom' &&
    message.customType === SESSION_CUSTOM_TYPE.USER_INPUT)

/** 仅裁剪模型可见副本；完整工具结果已经由 message_end 写入 Session。 */
export const pruneToolResults = (
  messages: readonly AgentMessage[],
  maxChars = 16_000,
) =>
  messages.map((message): AgentMessage => {
    if (
      message.role !== 'toolResult' ||
      message.toolName === BUILTIN_TOOL_NAME.READ_TOOL_RESULT
    )
      return message
    const texts = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
    const text = texts.join('\n')
    if (text.length <= maxChars) return message
    const details = message.details as Record<string, unknown> | undefined
    const outcome =
      details && typeof details === 'object'
        ? Object.fromEntries(
            ['exitCode', 'timedOut', 'outputExceeded'].flatMap((key) =>
              typeof details[key] === 'number' ||
              typeof details[key] === 'boolean' ||
              details[key] === null
                ? [[key, details[key]]]
                : [],
            ),
          )
        : {}
    const marker = `\n\n[Tool output shortened; tool=${message.toolName}; isError=${message.isError}; outcome=${JSON.stringify(outcome)}. Read the original with ${BUILTIN_TOOL_NAME.READ_TOOL_RESULT}({"toolCallId":${JSON.stringify(message.toolCallId)},"offset":0,"limit":${Math.min(4000, maxChars)}}).]\n\n`
    const size = Math.max(0, Math.floor((maxChars - marker.length - 3) / 2))
    return {
      ...message,
      content: [
        {
          type: 'text',
          text: `${marker}${text.slice(0, size)}\n…\n${size ? text.slice(-size) : ''}`,
        },
        ...message.content.filter((block) => block.type !== 'text'),
      ],
    }
  })

export function buildContextView(
  messages: readonly AgentMessage[],
  task: AgentMessage | undefined,
  todos: readonly TodoItem[] | undefined,
  maxToolChars = 16_000,
  pinned: readonly AgentMessage[] = [],
) {
  const sources = new Set<string>()
  const view = [...messages]
    .reverse()
    .filter((message) => {
      if (
        message.role !== 'custom' ||
        message.customType !== SESSION_CUSTOM_TYPE.AGENT_CONTEXT
      )
        return true
      const details = message.details as
        { source?: string; snapshot?: boolean } | undefined
      if (details?.source === 'task-recovery') return false
      if (!details?.snapshot || !details.source) return true
      // 同源快照保留最新值，普通 Skill 和用户消息不会被去重。
      if (sources.has(details.source)) return false
      sources.add(details.source)
      return true
    })
    .reverse()
  for (const message of [...pinned].reverse())
    if (
      !view.some(
        (item) =>
          item.role === message.role &&
          item.timestamp === message.timestamp &&
          JSON.stringify(item) === JSON.stringify(message),
      )
    )
      view.unshift(message)
  if (
    task &&
    !view.some(
      (message) =>
        isTaskMessage(message) &&
        message.timestamp === task.timestamp &&
        JSON.stringify(message) === JSON.stringify(task),
    )
  )
    view.unshift(task)
  const plan = buildCurrentTodosPrompt(todos)
  if (plan)
    view.unshift(
      createCustomMessage(
        SESSION_CUSTOM_TYPE.AGENT_CONTEXT,
        plan,
        false,
        { source: 'task-recovery' },
        0,
      ),
    )
  return pruneToolResults(view, maxToolChars)
}

/** 不允许压缩产生孤立结果或丢失尚未完成的工具调用。 */
export function assertToolPairs(messages: readonly AgentMessage[]) {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'toolResult') {
      if (!pending.delete(message.toolCallId))
        throw new AgentRuntimeError(
          'AGENT_COMPACTION_FAILED',
          '上下文工具结果缺少对应调用。',
          500,
        )
    } else {
      if (pending.size)
        throw new AgentRuntimeError(
          'AGENT_COMPACTION_FAILED',
          '上下文工具调用缺少执行结果。',
          500,
        )
      if (message.role === MESSAGE_ROLE.ASSISTANT)
        for (const block of message.content)
          if (block.type === 'toolCall') pending.add(block.id)
    }
  }
  if (pending.size)
    throw new AgentRuntimeError(
      'AGENT_COMPACTION_FAILED',
      '上下文工具调用尚未完成。',
      500,
    )
}
