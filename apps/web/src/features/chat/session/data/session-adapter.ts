import type {
  ChatMessage,
  ChatMessageActivityPart,
  ChatMessageTool,
  ChatThread,
} from '../../data/index.ts'
import {
  CHAT_ASSISTANT_STATUS,
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
} from '@oh-my-harness/shared'
import type { AgentSessionMessageVo, AgentSessionVo } from '../types/index.ts'

const SESSION_USER = {
  avatar: '',
  email: '',
  name: '你',
} as const

const toTimestamp = (value: number) => (value < 1e12 ? value * 1000 : value)

const toRunTimestamp = (value: number) => {
  const timestamp = toTimestamp(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

const formatSessionTime = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    month: 'numeric',
  }).format(toTimestamp(value))

const toChatTool = (
  tool: NonNullable<AgentSessionMessageVo['tools']>[number],
): ChatMessageTool => ({
  errorText: tool.errorText,
  input: tool.input,
  kind: tool.kind,
  outcome: tool.outcome,
  output: tool.output,
  state: tool.state,
  toolCallId: tool.toolCallId,
  toolName: tool.toolName,
})

/** 保留服务端消息块顺序，并为旧响应生成兼容的活动块。 */
const toActivityParts = (
  message: AgentSessionMessageVo,
  chatMessage: ChatMessage,
): ChatMessageActivityPart[] =>
  message.parts?.map((part) => {
    if (part.type === MESSAGE_PART_TYPE.REASONING) {
      return {
        reasoning: {
          defaultExpanded: false,
          steps: [{ content: part.reasoning, label: '思考过程' }],
        },
        type: MESSAGE_PART_TYPE.REASONING,
      }
    }
    if (part.type === 'text') return part
    return { tool: toChatTool(part.tool), type: MESSAGE_PART_TYPE.TOOL }
  }) ?? [
    ...(chatMessage.reasoning
      ? [
          {
            reasoning: chatMessage.reasoning,
            type: MESSAGE_PART_TYPE.REASONING,
          },
        ]
      : []),
    ...(chatMessage.text
      ? [{ text: chatMessage.text, type: 'text' as const }]
      : []),
    ...(chatMessage.tools ?? []).map((tool) => ({
      tool,
      type: MESSAGE_PART_TYPE.TOOL,
    })),
  ]

export const toChatMessage = (message: AgentSessionMessageVo): ChatMessage => ({
  actions: message.role === MESSAGE_ROLE.ASSISTANT ? 'full' : undefined,
  attachments: message.attachments,
  contextItems: message.contextItems,
  id: message.entryId,
  reasoning: message.reasoning
    ? {
        steps: [{ content: message.reasoning, label: '思考过程' }],
      }
    : undefined,
  role: message.role,
  status:
    message.role === MESSAGE_ROLE.ASSISTANT
      ? CHAT_ASSISTANT_STATUS.COMPLETE
      : undefined,
  text: message.content,
  tools: message.tools?.map(toChatTool),
})

const appendActivityText = (current?: string, next?: string) =>
  [current, next].filter(Boolean).join('\n\n') || undefined

const toActivityMessage = (
  message: ChatMessage,
  source: AgentSessionMessageVo,
  startedAt?: number,
): ChatMessage => ({
  activity: {
    parts: toActivityParts(source, message),
    reasoning: message.reasoning,
    startedAt,
    text: message.text,
    tools: message.tools ?? [],
  },
  id: `activity-${message.id}`,
  role: MESSAGE_ROLE.ASSISTANT,
  status: message.status,
})

const mergeActivityMessage = (
  activityMessage: ChatMessage,
  message: ChatMessage,
  source: AgentSessionMessageVo,
): ChatMessage => ({
  ...activityMessage,
  activity: {
    ...activityMessage.activity,
    parts: [
      ...(activityMessage.activity?.parts ?? []),
      ...toActivityParts(source, message),
    ],
    reasoning:
      activityMessage.activity?.reasoning || message.reasoning
        ? {
            defaultExpanded: false,
            steps: [
              ...(activityMessage.activity?.reasoning?.steps ?? []),
              ...(message.reasoning?.steps ?? []),
            ],
          }
        : undefined,
    text: appendActivityText(activityMessage.activity?.text, message.text),
    tools: [
      ...(activityMessage.activity?.tools ?? []),
      ...(message.tools ?? []),
    ],
  },
})

/** 将连续的历史 toolUse 消息投影为单个默认折叠活动。 */
export const toChatMessages = (
  messages: readonly AgentSessionMessageVo[],
): ChatMessage[] => {
  const chatMessages: ChatMessage[] = []
  let runStartedAt: number | undefined

  for (const message of messages) {
    const chatMessage = toChatMessage(message)
    const isToolActivity =
      message.role === MESSAGE_ROLE.ASSISTANT &&
      (message.stopReason === 'toolUse' || Boolean(message.tools?.length))
    const previous = chatMessages.at(-1)

    if (message.role === MESSAGE_ROLE.USER) {
      runStartedAt = toRunTimestamp(message.timestamp)
    }

    if (!isToolActivity) {
      if (previous?.activity && message.role === MESSAGE_ROLE.ASSISTANT) {
        const finalReasoningParts = toActivityParts(
          message,
          chatMessage,
        ).filter((part) => part.type === MESSAGE_PART_TYPE.REASONING)
        chatMessages[chatMessages.length - 1] = {
          ...previous,
          activity: {
            ...previous.activity,
            endedAt: toRunTimestamp(message.timestamp),
            hasError:
              message.stopReason === 'aborted' ||
              message.stopReason === 'error',
            parts: [...(previous.activity.parts ?? []), ...finalReasoningParts],
            reasoning: chatMessage.reasoning
              ? {
                  defaultExpanded: false,
                  steps: [
                    ...(previous.activity.reasoning?.steps ?? []),
                    ...chatMessage.reasoning.steps,
                  ],
                }
              : previous.activity.reasoning,
          },
        }
      }
      chatMessages.push(
        previous?.activity && message.role === MESSAGE_ROLE.ASSISTANT
          ? { ...chatMessage, reasoning: undefined }
          : chatMessage,
      )
      if (message.role === MESSAGE_ROLE.ASSISTANT) runStartedAt = undefined
    } else if (previous?.activity) {
      chatMessages[chatMessages.length - 1] = mergeActivityMessage(
        previous,
        chatMessage,
        message,
      )
    } else {
      chatMessages.push(toActivityMessage(chatMessage, message, runStartedAt))
    }
  }

  return chatMessages
}

export const toChatThread = (
  session: AgentSessionVo & {
    contextUsage?: ChatThread['contextUsage']
    pluginIds?: readonly string[]
  },
): ChatThread => ({
  archived: session.archived,
  ...(session.contextUsage ? { contextUsage: session.contextUsage } : {}),
  pluginIds: session.pluginIds,
  id: session.id,
  messages: [],
  modelId: session.modelId,
  preview: session.modelId,
  providerId: session.providerId,
  searchModeId: '',
  title: session.name ?? '新对话',
  updatedAt: formatSessionTime(session.createdAt),
  workspaceId: session.workspaceId,
  user: SESSION_USER,
})

export const createPendingChatThread = (sessionId: string): ChatThread => ({
  archived: false,
  id: sessionId,
  messages: [],
  modelId: '',
  preview: '',
  searchModeId: '',
  title: '会话',
  updatedAt: '',
  workspaceId: null,
  user: SESSION_USER,
})
