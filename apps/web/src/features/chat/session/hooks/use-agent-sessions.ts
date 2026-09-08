import { APPROVAL_DECISION } from '@oh-my-harness/agent-policy/contracts'
import {
  AGENT_RUN_EVENT_TYPE,
  CAPABILITY_KIND,
  CHAT_ASSISTANT_STATUS,
  CHAT_TOOL_KIND,
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  SESSION_TOOL_STATE,
  TODO_STATUS,
  TOOL_ACTIVITY_KIND,
} from '@oh-my-harness/shared'
import type { PermissionId } from '../../../settings/index.ts'
import { publishTraceUpdate } from '../../../trace/api/index.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStatus } from '@agile-avocation/ui-pro/prompt-input'
import type { ChatSubmitPayload } from '../../composer/index.ts'
import type {
  ChatMessage,
  ChatMessageActivityPart,
  ChatThread,
} from '../../data/index.ts'
import type { ApprovalDecision } from '../../message/index.ts'
import {
  abortAgentSession,
  clearArchivedAgentSessions,
  createAgentSession,
  deleteAgentSession,
  getAgentSession,
  getPendingToolApproval,
  listAgentSessionMessages,
  listAgentSessions,
  reconnectAgentRun,
  renameAgentSession,
  resolveToolApproval,
  streamAgentMessage,
  updateAgentSessionModel,
  updateAgentSessionArchived,
} from '../api/index.ts'
import { toChatMessages, toChatThread } from '../data/index.ts'
import type { PendingToolApprovalVo } from '../types/index.ts'

type PendingApprovalMap = Record<string, PendingToolApprovalVo | undefined>

const messageTitle = (message: string) =>
  message.trim().replace(/\s+/gu, ' ').slice(0, 60)

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '会话请求失败，请重试。'

/** 从会话键控状态中移除已永久删除的条目。 */
const omitSessions = <T>(
  values: Record<string, T>,
  sessionIds: ReadonlySet<string>,
) =>
  Object.fromEntries(
    Object.entries(values).filter(([sessionId]) => !sessionIds.has(sessionId)),
  ) as Record<string, T>

const toolOutputText = (output: unknown) => {
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return String(output ?? '')
  return output
    .flatMap((part) =>
      part && typeof part === 'object' && 'text' in part
        ? [String(part.text)]
        : [],
    )
    .join('\n')
}

const streamingAssistant = (id: string): ChatMessage => ({
  actions: 'full',
  id,
  role: MESSAGE_ROLE.ASSISTANT,
  status: CHAT_ASSISTANT_STATUS.STREAMING,
  text: '',
})

/** 只清除本次已决议的审批，避免覆盖抢先到达的下一条 SSE 审批。 */
export const clearResolvedApproval = (
  approvals: PendingApprovalMap,
  sessionId: string,
  approvalId: string,
) =>
  approvals[sessionId]?.approvalId === approvalId
    ? { ...approvals, [sessionId]: undefined }
    : approvals

/** 用户主动终止已有运行记录，不在输入框旁重复展示错误提示。 */
export const visibleRunError = (code: string, message: string) =>
  code === 'AGENT_RUN_ABORTED' ? '' : message

/** 读取流式消息的当前活动块，并兼容尚未携带 parts 的消息。 */
const messageActivityParts = (
  message: ChatMessage,
): ChatMessageActivityPart[] => {
  const parts = message.activity?.parts ?? message.parts
  if (parts) return [...parts]
  const reasoning = message.activity?.reasoning ?? message.reasoning
  const text = message.activity?.text ?? message.text
  const tools = message.activity?.tools ?? message.tools ?? []
  return [
    ...(reasoning ? [{ reasoning, type: MESSAGE_PART_TYPE.REASONING }] : []),
    ...(text ? [{ text, type: 'text' as const }] : []),
    ...tools.map((tool) => ({ tool, type: MESSAGE_PART_TYPE.TOOL })),
  ]
}

/** 合并相邻流式文本，跨工具调用时创建新的文本块。 */
const appendTextPart = (
  parts: readonly ChatMessageActivityPart[],
  delta: string,
) => {
  const next = [...parts]
  const last = next.at(-1)
  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` }
  } else {
    next.push({ text: delta, type: 'text' })
  }
  return next
}

/** 合并相邻流式推理，跨工具调用时创建新的推理块。 */
const appendReasoningPart = (
  parts: readonly ChatMessageActivityPart[],
  delta: string,
) => {
  const next = [...parts]
  const last = next.at(-1)
  if (last?.type === MESSAGE_PART_TYPE.REASONING) {
    const steps = [...last.reasoning.steps]
    const lastStep = steps.at(-1)
    if (lastStep) {
      steps[steps.length - 1] = {
        ...lastStep,
        content: `${lastStep.content}${delta}`,
      }
    } else {
      steps.push({ content: delta, label: '思考过程' })
    }
    next[next.length - 1] = {
      ...last,
      reasoning: { ...last.reasoning, steps },
    }
  } else {
    next.push({
      reasoning: {
        defaultExpanded: false,
        steps: [{ content: delta, label: '思考过程' }],
      },
      type: MESSAGE_PART_TYPE.REASONING,
    })
  }
  return next
}

/** 按事件到达位置追加流式文本，并合并相邻文本块。 */
export const appendStreamingText = (
  message: ChatMessage,
  delta: string,
): ChatMessage => {
  const parts = appendTextPart(messageActivityParts(message), delta)
  if (message.activity) {
    return {
      ...message,
      activity: {
        ...message.activity,
        parts,
        text: `${message.activity.text ?? ''}${delta}`,
      },
    }
  }
  return { ...message, parts, text: `${message.text ?? ''}${delta}` }
}

/** 按事件到达位置追加流式推理，并合并相邻推理块。 */
export const appendStreamingReasoning = (
  message: ChatMessage,
  delta: string,
): ChatMessage => {
  const reasoning = message.activity
    ? message.activity.reasoning
    : message.reasoning
  const content = reasoning?.steps[0]?.content ?? ''
  const nextReasoning = {
    defaultExpanded: !message.activity,
    steps: [{ content: `${content}${delta}`, label: '思考过程' }],
  }
  const parts = appendReasoningPart(messageActivityParts(message), delta)
  if (message.activity) {
    return {
      ...message,
      activity: { ...message.activity, parts, reasoning: nextReasoning },
    }
  }
  return { ...message, parts, reasoning: nextReasoning }
}

/** 将同一 toolCallId 的流式状态合并到当前 Assistant 消息。 */
export const updateStreamingTool = (
  message: ChatMessage,
  tool: NonNullable<ChatMessage['tools']>[number],
  startedAt: number,
) => {
  const tools = [...(message.activity?.tools ?? message.tools ?? [])]
  const index = tools.findIndex(
    (candidate) => candidate.toolCallId === tool.toolCallId,
  )
  if (index === -1) tools.push(tool)
  else tools[index] = { ...tools[index], ...tool }
  const parts = messageActivityParts(message)
  const partIndex = parts.findIndex(
    (part) =>
      part.type === MESSAGE_PART_TYPE.TOOL &&
      part.tool.toolCallId === tool.toolCallId,
  )
  if (partIndex === -1) parts.push({ tool, type: MESSAGE_PART_TYPE.TOOL })
  else {
    const part = parts[partIndex]
    if (part?.type === MESSAGE_PART_TYPE.TOOL) {
      parts[partIndex] = { ...part, tool: { ...part.tool, ...tool } }
    }
  }
  return {
    ...message,
    actions: undefined,
    activity: {
      parts,
      reasoning: message.activity?.reasoning ?? message.reasoning,
      startedAt: message.activity?.startedAt ?? startedAt,
      text: message.activity?.text ?? message.text,
      tools,
    },
    reasoning: undefined,
    parts: undefined,
    text: undefined,
    tools: undefined,
  }
}

/** 协调真实 Session 列表、历史消息和当前 POST SSE 运行。 */
export function useAgentSessions() {
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [runPermissions, setRunPermissions] = useState<
    Record<string, PermissionId | undefined>
  >({})
  const [statuses, setStatuses] = useState<Record<string, ChatStatus>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalMap>(
    {},
  )
  const [trajectoryVersions, setTrajectoryVersions] = useState<
    Record<string, number>
  >({})
  const statusRef = useRef<Record<string, ChatStatus>>({})
  const loadingRef = useRef(new Map<string, Promise<void>>())

  const setStatus = useCallback((sessionId: string, status: ChatStatus) => {
    statusRef.current = { ...statusRef.current, [sessionId]: status }
    setStatuses(statusRef.current)
    if (status === 'ready')
      setRunPermissions((current) => ({ ...current, [sessionId]: undefined }))
  }, [])

  const updateThread = useCallback(
    (sessionId: string, update: (thread: ChatThread) => ChatThread) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === sessionId ? update(thread) : thread,
        ),
      )
    },
    [],
  )

  const bumpTrajectory = useCallback((sessionId: string) => {
    setTrajectoryVersions((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? 0) + 1,
    }))
  }, [])

  const forgetSessions = useCallback((ids: readonly string[]) => {
    const sessionIds = new Set(ids)
    if (sessionIds.size === 0) return
    for (const sessionId of sessionIds) loadingRef.current.delete(sessionId)
    statusRef.current = omitSessions(statusRef.current, sessionIds)
    setThreads((current) =>
      current.filter((thread) => !sessionIds.has(thread.id)),
    )
    setStatuses(statusRef.current)
    setRunPermissions((current) => omitSessions(current, sessionIds))
    setErrors((current) => omitSessions(current, sessionIds))
    setPendingApprovals((current) => omitSessions(current, sessionIds))
    setTrajectoryVersions((current) => omitSessions(current, sessionIds))
    setLoadingIds(
      (current) => new Set([...current].filter((id) => !sessionIds.has(id))),
    )
  }, [])

  const loadMessages = useCallback(
    async (sessionId: string) => {
      const messages = []
      let before: number | undefined
      let todos: ChatThread['todos']
      do {
        const page = await listAgentSessionMessages(sessionId, before)
        if (before === undefined) todos = page.todos
        messages.push(...page.items)
        before = page.nextCursor ?? undefined
      } while (before !== undefined)

      const chatMessages = toChatMessages(
        messages.sort((left, right) => left.seq - right.seq),
      )
      updateThread(sessionId, (thread) => ({
        ...thread,
        messages: chatMessages,
        preview: chatMessages.at(-1)?.text ?? thread.preview,
        todos,
      }))
    },
    [updateThread],
  )

  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await listAgentSessions()
      setThreads((current) =>
        sessions.map((session) => {
          const next = toChatThread(session)
          const existing = current.find((thread) => thread.id === session.id)
          return existing
            ? {
                ...next,
                contextUsage:
                  existing.modelId === session.modelId &&
                  existing.providerId === session.providerId
                    ? existing.contextUsage
                    : undefined,
                messages: existing.messages,
                preview: existing.preview || next.preview,
                todos: existing.todos,
              }
            : next
        }),
      )
      setGlobalError('')
    } catch (error) {
      setGlobalError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Session list is external state loaded after mount.
    void refreshSessions()
  }, [refreshSessions])

  const loadThread = useCallback(
    (sessionId: string, reconnect = false) => {
      if (!reconnect && statusRef.current[sessionId] !== undefined) {
        return Promise.resolve()
      }
      const current = loadingRef.current.get(sessionId)
      if (current) return current

      setLoadingIds((ids) => new Set(ids).add(sessionId))
      setErrors((errors) => ({ ...errors, [sessionId]: '' }))
      let reconnectedTerminal = false
      const task = Promise.all([
        getAgentSession(sessionId),
        listAgentSessionMessages(sessionId),
        getPendingToolApproval(sessionId),
        reconnectAgentRun(sessionId, (event) => {
          if (
            event.type === AGENT_RUN_EVENT_TYPE.DONE ||
            event.type === AGENT_RUN_EVENT_TYPE.ERROR
          )
            reconnectedTerminal = true
          if (
            event.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED ||
            event.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA
          ) {
            publishTraceUpdate(sessionId, event)
          } else if (event.type === AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED) {
            bumpTrajectory(sessionId)
          } else if (event.type === AGENT_RUN_EVENT_TYPE.START) {
            setRunPermissions((current) => ({
              ...current,
              [sessionId]: event.permission,
            }))
          } else if (
            event.type === AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED
          ) {
            setPendingApprovals((current) => ({
              ...current,
              [sessionId]: event,
            }))
          } else if (event.type === AGENT_RUN_EVENT_TYPE.TOOL_END) {
            setPendingApprovals((current) =>
              current[sessionId]?.toolCallId === event.toolCallId
                ? { ...current, [sessionId]: undefined }
                : current,
            )
          } else if (event.type === AGENT_RUN_EVENT_TYPE.TODO_UPDATED) {
            updateThread(sessionId, (thread) => ({
              ...thread,
              todos: event.todos.length ? event.todos : undefined,
            }))
          } else if (
            event.type === AGENT_RUN_EVENT_TYPE.USAGE &&
            event.contextUsage
          ) {
            updateThread(sessionId, (thread) => ({
              ...thread,
              contextUsage: event.contextUsage,
            }))
          } else if (event.type === AGENT_RUN_EVENT_TYPE.ERROR) {
            setErrors((current) => ({
              ...current,
              [sessionId]: event.message,
            }))
          }
        }),
      ])
        .then(async ([session, firstPage, pendingApproval, reconnectedRun]) => {
          setPendingApprovals((current) => ({
            ...current,
            [sessionId]: current[sessionId] ?? pendingApproval,
          }))
          const next = toChatThread(session)
          const firstMessages = firstPage.items
          setThreads((threads) => {
            const existing = threads.find((thread) => thread.id === sessionId)
            const updated = {
              ...next,
              messages: existing?.messages ?? [],
              todos:
                existing && Object.hasOwn(existing, 'todos')
                  ? existing.todos
                  : firstPage.todos,
            }
            return existing
              ? threads.map((thread) =>
                  thread.id === sessionId ? updated : thread,
                )
              : [updated, ...threads]
          })
          if (firstPage.nextCursor === null) {
            const messages = toChatMessages(
              firstMessages.sort((left, right) => left.seq - right.seq),
            )
            updateThread(sessionId, (thread) => ({
              ...thread,
              messages,
              todos: firstPage.todos,
            }))
          } else {
            await loadMessages(sessionId)
          }
          setStatus(sessionId, reconnectedRun ? 'streaming' : 'ready')
          if (reconnectedRun) {
            void reconnectedRun.completed
              .then(async () => {
                await loadMessages(sessionId)
                const nextApproval = await getPendingToolApproval(sessionId)
                setPendingApprovals((current) => ({
                  ...current,
                  [sessionId]: nextApproval,
                }))
              })
              .catch((error) => {
                setErrors((current) => ({
                  ...current,
                  [sessionId]: errorMessage(error),
                }))
              })
              .finally(() => {
                if (reconnectedTerminal) setStatus(sessionId, 'ready')
                else
                  setErrors((current) => ({
                    ...current,
                    [sessionId]:
                      '连接已中断，本轮权限保持不变。请刷新重连或停止本轮。',
                  }))
              })
          }
        })
        .catch((error) => {
          setErrors((current) => ({
            ...current,
            [sessionId]: errorMessage(error),
          }))
        })
        .finally(() => {
          loadingRef.current.delete(sessionId)
          setLoadingIds((ids) => {
            const next = new Set(ids)
            next.delete(sessionId)
            return next
          })
        })
      loadingRef.current.set(sessionId, task)
      return task
    },
    [bumpTrajectory, loadMessages, setStatus, updateThread],
  )

  const createSession = useCallback(async (payload: ChatSubmitPayload) => {
    setIsCreating(true)
    setGlobalError('')
    try {
      const title = messageTitle(payload.message)
      const session = await createAgentSession({
        modelId: payload.modelId,
        ...(title ? { name: title } : {}),
        providerId: payload.providerId,
        workspaceId: payload.workspaceId,
      })
      const thread = toChatThread(session)
      setThreads((current) => [
        thread,
        ...current.filter((item) => item.id !== thread.id),
      ])
      return thread
    } catch (error) {
      setGlobalError(errorMessage(error))
      throw error
    } finally {
      setIsCreating(false)
    }
  }, [])

  const updateModel = useCallback(
    async (
      sessionId: string,
      input: Pick<ChatSubmitPayload, 'modelId' | 'providerId'>,
    ) => {
      setErrors((current) => ({ ...current, [sessionId]: '' }))
      try {
        const session = await updateAgentSessionModel(sessionId, input)
        updateThread(sessionId, (thread) => ({
          ...thread,
          contextUsage: undefined,
          modelId: session.modelId,
          providerId: session.providerId,
        }))
        return true
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [sessionId]: errorMessage(error),
        }))
        return false
      }
    },
    [updateThread],
  )

  const renameSession = useCallback(
    async (sessionId: string, name: string) => {
      setErrors((current) => ({ ...current, [sessionId]: '' }))
      try {
        const session = await renameAgentSession(sessionId, { name })
        updateThread(sessionId, (thread) => ({
          ...thread,
          title: session.name ?? '新对话',
        }))
        return ''
      } catch (error) {
        const message = errorMessage(error)
        setErrors((current) => ({ ...current, [sessionId]: message }))
        return message
      }
    },
    [updateThread],
  )

  const setSessionArchived = useCallback(
    async (sessionId: string, archived: boolean) => {
      setErrors((current) => ({ ...current, [sessionId]: '' }))
      try {
        const session = await updateAgentSessionArchived(sessionId, {
          archived,
        })
        updateThread(sessionId, (thread) => ({
          ...thread,
          archived: session.archived,
        }))
        return ''
      } catch (error) {
        const message = errorMessage(error)
        setErrors((current) => ({ ...current, [sessionId]: message }))
        return message
      }
    },
    [updateThread],
  )

  /** 永久删除单个会话并清理对应的页面运行状态。 */
  const deleteSessionPermanently = useCallback(
    async (sessionId: string) => {
      try {
        await deleteAgentSession(sessionId)
        forgetSessions([sessionId])
        return ''
      } catch (error) {
        return errorMessage(error)
      }
    },
    [forgetSessions],
  )

  /** 清空当前归档会话；失败时重新读取服务端权威列表。 */
  const clearArchivedSessions = useCallback(async () => {
    const archivedIds = threads
      .filter((thread) => thread.archived)
      .map((thread) => thread.id)
    try {
      await clearArchivedAgentSessions()
      forgetSessions(archivedIds)
      return ''
    } catch (error) {
      await refreshSessions()
      return errorMessage(error)
    }
  }, [forgetSessions, refreshSessions, threads])

  const sendMessage = useCallback(
    async (sessionId: string, payload: ChatSubmitPayload) => {
      const startedAt = Date.now()
      const userId = `pending-user-${crypto.randomUUID()}`
      const assistantId = `pending-assistant-${crypto.randomUUID()}`
      const previewUrls: string[] = []
      const attachments = payload.attachments.map((file) => {
        const src = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined
        if (src) previewUrls.push(src)
        return { mimeType: file.type, name: file.name, src }
      })
      const contextItems = payload.contextItems.filter(
        (item) =>
          item.kind === CAPABILITY_KIND.COMMAND ||
          item.kind === CAPABILITY_KIND.SKILL ||
          item.kind === CAPABILITY_KIND.PLUGIN,
      )
      const preview =
        payload.message || attachments[0]?.name || contextItems[0]?.label || ''
      setErrors((current) => ({ ...current, [sessionId]: '' }))
      setRunPermissions((current) => ({
        ...current,
        [sessionId]: payload.permission,
      }))
      setStatus(sessionId, 'submitted')
      updateThread(sessionId, (thread) => ({
        ...thread,
        messages: [
          ...thread.messages,
          {
            attachments,
            contextItems,
            id: userId,
            role: MESSAGE_ROLE.USER,
            text: payload.message,
          },
          streamingAssistant(assistantId),
        ],
        preview,
        pluginIds: contextItems.flatMap((item) =>
          item.kind === CAPABILITY_KIND.PLUGIN && item.sourceId
            ? [item.sourceId]
            : [],
        ),
        todos: undefined,
        updatedAt: '刚刚',
      }))

      let terminal = false
      let runError = ''
      try {
        await streamAgentMessage(
          sessionId,
          {
            attachments: payload.attachments,
            commandId: contextItems.find(
              (item) => item.kind === CAPABILITY_KIND.COMMAND,
            )?.sourceId,
            content: payload.message,
            pluginIds: contextItems.flatMap((item) =>
              item.kind === CAPABILITY_KIND.PLUGIN && item.sourceId
                ? [item.sourceId]
                : [],
            ),
            permission: payload.permission,
            skillIds: contextItems.flatMap((item) =>
              item.kind === CAPABILITY_KIND.SKILL && item.sourceId
                ? [item.sourceId]
                : [],
            ),
            thinkingLevel: payload.thinkingLevel,
          },
          (event) => {
            switch (event.type) {
              case AGENT_RUN_EVENT_TYPE.TRAJECTORY_UPDATED:
              case AGENT_RUN_EVENT_TYPE.TRAJECTORY_DELTA:
                publishTraceUpdate(sessionId, event)
                break
              case AGENT_RUN_EVENT_TYPE.TRAJECTORY_CHANGED:
                bumpTrajectory(sessionId)
                break
              case AGENT_RUN_EVENT_TYPE.START:
                setRunPermissions((current) => ({
                  ...current,
                  [sessionId]: event.permission,
                }))
                setStatus(sessionId, 'streaming')
                break
              case AGENT_RUN_EVENT_TYPE.TEXT_DELTA:
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId
                      ? appendStreamingText(item, event.delta)
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.REASONING_DELTA:
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId
                      ? appendStreamingReasoning(item, event.delta)
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.TODO_UPDATED:
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  todos: event.todos.length ? event.todos : undefined,
                }))
                break
              case AGENT_RUN_EVENT_TYPE.TOOL_START:
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId
                      ? updateStreamingTool(
                          item,
                          {
                            input: event.input,
                            kind: event.kind,
                            state: SESSION_TOOL_STATE.INPUT_AVAILABLE,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                          },
                          startedAt,
                        )
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.TOOL_END:
                setPendingApprovals((current) =>
                  current[sessionId]?.toolCallId === event.toolCallId
                    ? { ...current, [sessionId]: undefined }
                    : current,
                )
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId
                      ? updateStreamingTool(
                          item,
                          {
                            ...(event.isError
                              ? { errorText: toolOutputText(event.output) }
                              : { output: event.output }),
                            input: event.filePath
                              ? { path: event.filePath }
                              : ((item.activity?.tools ?? item.tools)?.find(
                                  (tool) =>
                                    tool.toolCallId === event.toolCallId,
                                )?.input ?? {}),
                            kind: event.kind,
                            outcome: event.outcome,
                            state: event.isError
                              ? SESSION_TOOL_STATE.OUTPUT_ERROR
                              : SESSION_TOOL_STATE.OUTPUT_AVAILABLE,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                          },
                          startedAt,
                        )
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED:
                setPendingApprovals((current) => ({
                  ...current,
                  [sessionId]: event,
                }))
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId
                      ? updateStreamingTool(
                          item,
                          {
                            approval: {
                              ...('input' in event
                                ? {
                                    description: JSON.stringify(
                                      event.input,
                                      null,
                                      2,
                                    ),
                                  }
                                : {}),
                              title: event.title,
                            },
                            input:
                              'input' in event
                                ? event.input
                                : { path: event.path },
                            kind:
                              event.kind === TOOL_ACTIVITY_KIND.MCP
                                ? CHAT_TOOL_KIND.TOOL
                                : event.kind,
                            state: 'requires-action',
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                          },
                          startedAt,
                        )
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.DONE:
                terminal = true
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId && item.activity
                      ? {
                          ...item,
                          activity: { ...item.activity, endedAt: Date.now() },
                        }
                      : item,
                  ),
                }))
                break
              case AGENT_RUN_EVENT_TYPE.ERROR:
                terminal = true
                runError = visibleRunError(event.code, event.message)
                updateThread(sessionId, (thread) => ({
                  ...thread,
                  messages: thread.messages.map((item) =>
                    item.id === assistantId && item.activity
                      ? {
                          ...item,
                          activity: {
                            ...item.activity,
                            endedAt: Date.now(),
                            hasError: true,
                          },
                        }
                      : item,
                  ),
                  todos: thread.todos?.every(
                    (todo) => todo.status === TODO_STATUS.COMPLETED,
                  )
                    ? thread.todos
                    : undefined,
                }))
                break
              case AGENT_RUN_EVENT_TYPE.USAGE:
                if (event.contextUsage) {
                  updateThread(sessionId, (thread) => ({
                    ...thread,
                    contextUsage: event.contextUsage,
                  }))
                }
                break
            }
          },
        )
        if (!terminal) runError = '连接已中断，已重新加载持久化消息。'
      } catch (error) {
        runError = errorMessage(error)
      }

      try {
        await loadMessages(sessionId)
        const pendingApproval = await getPendingToolApproval(sessionId)
        setPendingApprovals((current) => ({
          ...current,
          [sessionId]: pendingApproval,
        }))
      } catch (error) {
        runError ||= errorMessage(error)
      } finally {
        previewUrls.forEach((url) => URL.revokeObjectURL(url))
        if (terminal) setStatus(sessionId, 'ready')
        else await loadThread(sessionId, true)
      }
      if (runError) {
        setErrors((current) => ({ ...current, [sessionId]: runError }))
      }
    },
    [bumpTrajectory, loadMessages, loadThread, setStatus, updateThread],
  )

  const abort = useCallback(
    async (sessionId: string) => {
      updateThread(sessionId, (thread) => ({
        ...thread,
        todos: thread.todos?.every(
          (todo) => todo.status === TODO_STATUS.COMPLETED,
        )
          ? thread.todos
          : undefined,
      }))
      try {
        await abortAgentSession(sessionId)
        setPendingApprovals((current) => ({
          ...current,
          [sessionId]: undefined,
        }))
        setStatus(sessionId, 'ready')
        await loadMessages(sessionId)
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [sessionId]: errorMessage(error),
        }))
      }
    },
    [loadMessages, setStatus, updateThread],
  )

  const resolveApproval = useCallback(
    async (sessionId: string, decision: ApprovalDecision) => {
      const approval = pendingApprovals[sessionId]
      if (!approval) return
      try {
        await resolveToolApproval(sessionId, approval.approvalId, decision)
        if (decision === APPROVAL_DECISION.APPROVE_ONCE) {
          const resumedAt = Date.now()
          updateThread(sessionId, (thread) => ({
            ...thread,
            messages: thread.messages.map((message) => {
              const tool = (message.activity?.tools ?? message.tools)?.find(
                (candidate) =>
                  candidate.toolCallId === approval.toolCallId &&
                  candidate.state === 'requires-action',
              )
              return tool
                ? updateStreamingTool(
                    message,
                    {
                      ...tool,
                      approval: undefined,
                      state: SESSION_TOOL_STATE.INPUT_AVAILABLE,
                    },
                    resumedAt,
                  )
                : message
            }),
          }))
        }
        setPendingApprovals((current) =>
          clearResolvedApproval(current, sessionId, approval.approvalId),
        )
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [sessionId]: errorMessage(error),
        }))
      }
    },
    [pendingApprovals, updateThread],
  )

  return {
    abort,
    clearArchivedSessions,
    createSession,
    deleteSessionPermanently,
    errors,
    globalError,
    forgetSessions,
    isCreating,
    loadingIds,
    loadThread,
    pendingApprovals,
    refreshSessions,
    renameSession,
    resolveApproval,
    sendMessage,
    statuses,
    runPermissions,
    setSessionArchived,
    threads,
    trajectoryVersions,
    updateModel,
  }
}
