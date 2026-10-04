import type {
  AgentRuntime,
  AgentSessionDetail,
  AgentSessionInfo,
  AgentSessionMessagePage,
  AgentTrajectory,
  AgentTrajectoryRecord,
} from '@oh-my-harness/agent-runtime'
import {
  AGENT_TRAJECTORY_RECORD_KIND,
  AGENT_TRAJECTORY_STATUS,
  MESSAGE_ACTION,
  MESSAGE_FEEDBACK,
  type MessageAction,
  type MessageFeedback,
} from '@oh-my-harness/shared'
import type { Context } from 'hono'

import type {
  AgentSessionDetailDto,
  AgentSessionForkDto,
  AgentSessionRegenerateDto,
  AgentSessionDto,
  AgentSessionMessagePageDto,
  AgentTrajectoryDto,
  AgentTrajectoryRecordDetailDto,
  AgentTrajectorySearchDto,
  CreateAgentSessionDto,
  ForkAgentSessionDto,
  RegenerateAgentSessionDto,
  SetAgentSessionFeedbackDto,
  UpdateAgentSessionDto,
} from '../../dto/agent/session-dto.ts'
import type { WorkspaceStore } from '../../infrastructure/workspace/workspace-store.ts'
import { agentErrorResponse } from './error-response.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

function parseCreateSession(value: unknown): CreateAgentSessionDto | undefined {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ['modelId', 'name', 'providerId', 'workspaceId'])
  ) {
    return undefined
  }
  const providerId =
    typeof value.providerId === 'string' ? value.providerId.trim() : ''
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : undefined
  const workspaceId =
    typeof value.workspaceId === 'string' ? value.workspaceId.trim() : ''
  if (
    !providerId ||
    providerId.length > 512 ||
    !modelId ||
    modelId.length > 512 ||
    !workspaceId ||
    workspaceId.length > 200 ||
    (value.name !== undefined && (!name || name.length > 200))
  ) {
    return undefined
  }
  return { modelId, ...(name ? { name } : {}), providerId, workspaceId }
}

function parseUpdateSession(value: unknown): UpdateAgentSessionDto | undefined {
  if (!isObject(value)) return undefined
  if (hasOnlyKeys(value, ['archived']) && Object.hasOwn(value, 'archived')) {
    return typeof value.archived === 'boolean'
      ? { archived: value.archived }
      : undefined
  }
  if (hasOnlyKeys(value, ['name']) && Object.hasOwn(value, 'name')) {
    if (value.name === null) return { name: null }
    if (typeof value.name !== 'string') return undefined
    const name = value.name.trim()
    return name && name.length <= 200 ? { name } : undefined
  }
  if (
    !hasOnlyKeys(value, ['modelId', 'providerId']) ||
    !Object.hasOwn(value, 'modelId') ||
    !Object.hasOwn(value, 'providerId')
  ) {
    return undefined
  }
  const providerId =
    typeof value.providerId === 'string' ? value.providerId.trim() : ''
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : ''
  return providerId &&
    providerId.length <= 512 &&
    modelId &&
    modelId.length <= 512
    ? { modelId, providerId }
    : undefined
}

function parseForkSession(value: unknown): ForkAgentSessionDto | undefined {
  if (!isObject(value)) return undefined
  if (
    Object.keys(value).some(
      (key) => !['action', 'content', 'messageId'].includes(key),
    ) ||
    typeof value.messageId !== 'string' ||
    !value.messageId.trim() ||
    value.messageId.length > 256 ||
    value.messageId.includes('\0') ||
    !Object.values(MESSAGE_ACTION).includes(
      value.action as (typeof MESSAGE_ACTION)[keyof typeof MESSAGE_ACTION],
    )
  )
    return undefined
  if (value.action === MESSAGE_ACTION.REGENERATE) return undefined
  if (value.action === MESSAGE_ACTION.EDIT) {
    if (
      typeof value.content !== 'string' ||
      !value.content.trim() ||
      value.content.length > 1_000_000
    )
      return undefined
    return {
      action: value.action as Exclude<MessageAction, 'regenerate'>,
      content: value.content,
      messageId: value.messageId,
    }
  }
  if (value.content !== undefined) return undefined
  return {
    action: value.action as Exclude<MessageAction, 'regenerate'>,
    messageId: value.messageId,
  }
}

function parseRegenerateSession(
  value: unknown,
): RegenerateAgentSessionDto | undefined {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ['messageId']) ||
    typeof value.messageId !== 'string' ||
    !value.messageId.trim() ||
    value.messageId.length > 256 ||
    value.messageId.includes('\0')
  ) {
    return undefined
  }
  return { messageId: value.messageId }
}

function parseFeedback(value: unknown): SetAgentSessionFeedbackDto | undefined {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => key !== 'feedback') ||
    !Object.hasOwn(value, 'feedback')
  )
    return undefined
  if (
    value.feedback !== null &&
    !Object.values(MESSAGE_FEEDBACK).includes(
      value.feedback as (typeof MESSAGE_FEEDBACK)[keyof typeof MESSAGE_FEEDBACK],
    )
  )
    return undefined
  return { feedback: value.feedback as MessageFeedback | null }
}

function parseMessagesQuery(context: Context) {
  const limitSource = context.req.query('limit')
  const beforeSource = context.req.query('before')
  const limit = limitSource === undefined ? 50 : Number(limitSource)
  const before = beforeSource === undefined ? undefined : Number(beforeSource)
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
  ) {
    return undefined
  }
  return { ...(before === undefined ? {} : { before }), limit }
}

function sessionDto(
  session: AgentSessionInfo,
  workspaceId: string | null,
): AgentSessionDto {
  return {
    archived: session.archived,
    createdAt: session.createdAt,
    id: session.id,
    modelId: session.modelId,
    name: session.name,
    providerId: session.providerId,
    workspaceId,
  }
}

function sessionDetailDto(
  session: AgentSessionDetail,
  workspaceId: string | null,
): AgentSessionDetailDto {
  return {
    ...sessionDto(session, workspaceId),
    ...(session.contextUsage ? { contextUsage: session.contextUsage } : {}),
    permission: session.permission,
    stats: session.stats,
  }
}

async function workspaceMap(workspaces: WorkspaceStore) {
  return new Map(
    (await workspaces.list()).map((workspace) => [
      workspace.path,
      workspace.id,
    ]),
  )
}

function messagePageDto(
  sessionId: string,
  page: AgentSessionMessagePage,
): AgentSessionMessagePageDto {
  return {
    ...page,
    items: page.items.map((message) => ({
      ...message,
      attachments: message.attachments?.map((attachment) => ({
        ...attachment,
        src: `/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachment.id)}`,
      })),
    })),
  }
}

function trajectoryRecordDto(record: AgentTrajectoryRecord) {
  const { preview, raw: _raw, source, detail, ...summary } = record
  return record.status === AGENT_TRAJECTORY_STATUS.RUNNING &&
    record.kind === AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT
    ? { ...summary, preview, source, detail }
    : summary
}

function trajectoryDto(trajectory: AgentTrajectory): AgentTrajectoryDto {
  return {
    ...trajectory,
    records: trajectory.records.map(trajectoryRecordDto),
  }
}

/** 创建 Agent Session CRUD 与消息读取 Controller。 */
export function createAgentSessionController(
  runtime: AgentRuntime,
  workspaces: WorkspaceStore,
) {
  return {
    create: async (context: Context) => {
      const input = parseCreateSession(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_SESSION_REQUEST', message: '会话请求无效。' },
          400,
        )
      }
      try {
        const session = await workspaces.withAvailable(
          input.workspaceId,
          async (workspace) =>
            sessionDto(
              await runtime.createSession({
                cwd: workspace.path,
                modelId: input.modelId,
                ...(input.name ? { name: input.name } : {}),
                providerId: input.providerId,
              }),
              workspace.id,
            ),
        )
        return context.json(session, 201)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    clearArchived: async (context: Context) => {
      try {
        await runtime.deleteArchivedSessions()
        return context.body(null, 204)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    feedback: async (context: Context) => {
      const input = parseFeedback(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_MESSAGE_FEEDBACK', message: '消息反馈无效。' },
          400,
        )
      }
      try {
        const messageId = context.req.param('messageId')!
        return context.json(
          await runtime.setMessageFeedback(
            context.req.param('id')!,
            messageId,
            input.feedback,
          ),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    fork: async (context: Context) => {
      const input = parseForkSession(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_SESSION_REQUEST', message: '分支请求无效。' },
          400,
        )
      }
      try {
        const result = await runtime.forkSession(
          context.req.param('id')!,
          input,
        )
        const ids = await workspaceMap(workspaces)
        return context.json(
          {
            runRequired: Boolean(result.prompt),
            session: sessionDto(result.info, ids.get(result.info.cwd) ?? null),
            sourceMessageId: result.sourceMessageId,
            sourceSessionId: result.sourceSessionId,
          } satisfies AgentSessionForkDto,
          201,
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    regenerate: async (context: Context) => {
      const input = parseRegenerateSession(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_SESSION_REQUEST', message: '重新生成请求无效。' },
          400,
        )
      }
      try {
        const result = await runtime.regenerateSession(
          context.req.param('id')!,
          input.messageId,
        )
        const ids = await workspaceMap(workspaces)
        return context.json({
          runRequired: true,
          session: sessionDto(result.info, ids.get(result.info.cwd) ?? null),
          sourceMessageId: result.sourceMessageId,
          sourceSessionId: result.sourceSessionId,
        } satisfies AgentSessionRegenerateDto)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    delete: async (context: Context) => {
      try {
        await runtime.deleteSession(context.req.param('id')!)
        return context.body(null, 204)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    get: async (context: Context) => {
      try {
        const session = await runtime.getSession(context.req.param('id')!)
        const ids = await workspaceMap(workspaces)
        return context.json(
          sessionDetailDto(session, ids.get(session.cwd) ?? null),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    list: async (context: Context) => {
      try {
        const [sessions, ids] = await Promise.all([
          runtime.listSessions(),
          workspaceMap(workspaces),
        ])
        return context.json(
          sessions.map((session) =>
            sessionDto(session, ids.get(session.cwd) ?? null),
          ) satisfies AgentSessionDto[],
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    messages: async (context: Context) => {
      const query = parseMessagesQuery(context)
      if (!query) {
        return context.json(
          { code: 'INVALID_SESSION_REQUEST', message: '分页参数无效。' },
          400,
        )
      }
      try {
        const sessionId = context.req.param('id')!
        return context.json(
          messagePageDto(
            sessionId,
            await runtime.getMessages(sessionId, query),
          ),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    trajectory: async (context: Context) => {
      try {
        context.header('cache-control', 'private, no-store')
        return context.json(
          trajectoryDto(await runtime.getTrajectory(context.req.param('id')!)),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    /** 从完整脱敏投影搜索，返回身份而非正文，不扩张列表载荷。 */
    trajectorySearch: async (context: Context) => {
      context.header('cache-control', 'private, no-store')
      const query = context.req.query('q') ?? ''
      if (query.length > 512)
        return context.json(
          { code: 'INVALID_QUERY', message: '搜索词不能超过 512 个字符。' },
          400,
        )
      const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
      try {
        const trajectory = await runtime.getTrajectory(context.req.param('id')!)
        const recordIds = trajectory.records
          .filter((record) => {
            if (!terms.length) return true
            const text = [
              record.kind,
              record.label,
              record.status,
              record.source,
              `run ${record.runNumber}`,
              `turn ${record.turn}`,
              record.request ? `request ${record.request}` : '',
              record.summary,
              record.preview,
              JSON.stringify(record.detail),
            ]
              .join('\n')
              .toLowerCase()
            return terms.every((term) => text.includes(term))
          })
          .map((record) => record.id)
        return context.json({
          recordIds,
          cursor: trajectory.cursor,
        } satisfies AgentTrajectorySearchDto)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    trajectoryRecord: async (context: Context) => {
      try {
        context.header('cache-control', 'private, no-store')
        return context.json(
          (await runtime.getTrajectoryRecord(
            context.req.param('id')!,
            context.req.param('recordId')!,
          )) satisfies AgentTrajectoryRecordDetailDto,
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    attachment: async (context: Context) => {
      try {
        const attachment = await runtime.getAttachment(
          context.req.param('id')!,
          context.req.param('attachmentId')!,
        )
        return context.body(attachment.data, 200, {
          'cache-control': 'private, no-store',
          'content-disposition': attachment.mimeType.startsWith('image/')
            ? 'inline'
            : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
          'content-length': String(attachment.data.byteLength),
          'content-type': attachment.mimeType,
          'x-content-type-options': 'nosniff',
        })
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    update: async (context: Context) => {
      const input = parseUpdateSession(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_SESSION_REQUEST', message: '会话更新请求无效。' },
          400,
        )
      }
      try {
        const session =
          'name' in input
            ? await runtime.renameSession(
                context.req.param('id')!,
                input.name ?? undefined,
              )
            : 'archived' in input
              ? await runtime.archiveSession(
                  context.req.param('id')!,
                  input.archived,
                )
              : await runtime.updateSessionModel(
                  context.req.param('id')!,
                  input,
                )
        const ids = await workspaceMap(workspaces)
        return context.json(sessionDto(session, ids.get(session.cwd) ?? null))
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
  }
}
