import {
  isToolPermission,
  isApprovalDecision,
  type ApprovalDecision,
} from '@oh-my-harness/agent-policy'
import {
  AgentRuntimeError,
  type AgentRun,
  type AgentRunAttachment,
  type AgentRuntime,
  type ModelThinkingLevel,
} from '@oh-my-harness/agent-runtime'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { MODEL_THINKING_LEVEL } from '@oh-my-harness/shared'

import type {
  AgentRunEventDto,
  SendAgentMessageDto,
} from '../../dto/agent/run-dto.ts'
import { agentErrorResponse } from './error-response.ts'

const MAX_ATTACHMENTS = 5
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const thinkingLevels = new Set<ModelThinkingLevel>(
  Object.values(MODEL_THINKING_LEVEL),
)

function parseMessage(
  value: unknown,
): Omit<SendAgentMessageDto, 'attachments'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.content === 'string' && record.content.length > 1_000_000) {
    throw new AgentRuntimeError('REQUEST_TOO_LARGE', '请求内容过大。', 413)
  }
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'commandId' &&
        key !== 'content' &&
        key !== 'permission' &&
        key !== 'skillIds' &&
        key !== 'pluginIds' &&
        key !== 'thinkingLevel',
    ) ||
    typeof record.content !== 'string' ||
    !isToolPermission(record.permission) ||
    (record.thinkingLevel !== undefined &&
      !thinkingLevels.has(record.thinkingLevel as ModelThinkingLevel))
  ) {
    return undefined
  }
  const commandId =
    typeof record.commandId === 'string' ? record.commandId.trim() : undefined
  if (
    record.commandId !== undefined &&
    (!commandId || commandId.length > 128)
  ) {
    return undefined
  }
  if (
    record.skillIds !== undefined &&
    (!Array.isArray(record.skillIds) ||
      record.skillIds.length > 20 ||
      record.skillIds.some(
        (id) => typeof id !== 'string' || !id || id.length > 128,
      ) ||
      new Set(record.skillIds).size !== record.skillIds.length)
  ) {
    return undefined
  }
  const skillIds = record.skillIds as string[] | undefined
  if (
    record.pluginIds !== undefined &&
    (!Array.isArray(record.pluginIds) ||
      record.pluginIds.length > 20 ||
      record.pluginIds.some(
        (id) => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id),
      ) ||
      new Set(record.pluginIds).size !== record.pluginIds.length)
  )
    return undefined
  return {
    ...(record.pluginIds === undefined
      ? {}
      : { pluginIds: record.pluginIds as string[] }),
    ...(commandId ? { commandId } : {}),
    content: record.content,
    permission: record.permission,
    ...(skillIds?.length ? { skillIds } : {}),
    ...(record.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: record.thinkingLevel as ModelThinkingLevel }),
  }
}

const detectedImageMimeType = (bytes: Uint8Array) => {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  const header = Buffer.from(bytes.subarray(0, 12)).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}

const safeDeclaredMimeType = (value: string) =>
  value.length <= 255 &&
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(value) &&
  !value.toLocaleLowerCase().startsWith('image/')
    ? value
    : 'application/octet-stream'

const safeAttachmentName = (value: string) =>
  Boolean(value) &&
  value.length <= 255 &&
  ![...value].some((character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 32 || code === 127
  })

async function parseAttachments(files: File[]) {
  if (files.length > MAX_ATTACHMENTS) {
    throw new AgentRuntimeError('REQUEST_TOO_LARGE', '附件数量过多。', 413)
  }
  let totalBytes = 0
  const attachments: AgentRunAttachment[] = []
  for (const file of files) {
    if (!safeAttachmentName(file.name)) {
      return undefined
    }
    totalBytes += file.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new AgentRuntimeError('REQUEST_TOO_LARGE', '附件总大小过大。', 413)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const imageMimeType = detectedImageMimeType(bytes)
    attachments.push({
      data: bytes,
      mimeType: imageMimeType || safeDeclaredMimeType(file.type),
      name: file.name,
      size: file.size,
    })
  }
  return attachments
}

async function parsePromptRequest(context: Context) {
  const contentType = context.req.header('content-type') ?? ''
  if (!contentType.toLocaleLowerCase().startsWith('multipart/form-data')) {
    const input = parseMessage(
      await context.req.json<unknown>().catch(() => undefined),
    )
    return input &&
      (input.content.trim() || input.commandId || input.skillIds?.length)
      ? input
      : undefined
  }
  const form = await context.req.formData().catch(() => undefined)
  if (!form) return undefined
  const entries = [...form.entries()]
  if (
    entries.some(([key]) => key !== 'request' && key !== 'attachments') ||
    form.getAll('request').length !== 1
  ) {
    return undefined
  }
  const request = form.get('request')
  if (typeof request !== 'string') return undefined
  let requestValue: unknown
  try {
    requestValue = JSON.parse(request) as unknown
  } catch {
    return undefined
  }
  const input = parseMessage(requestValue)
  const fileValues = form.getAll('attachments')
  if (!input || fileValues.some((file) => !(file instanceof File))) {
    return undefined
  }
  const attachments = await parseAttachments(fileValues as File[])
  return attachments &&
    (input.content.trim() ||
      input.commandId ||
      input.skillIds?.length ||
      attachments.length)
    ? { ...input, attachments }
    : undefined
}

function parseApprovalDecision(value: unknown): ApprovalDecision | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).some((key) => key !== 'decision') ||
    !isApprovalDecision(record.decision)
  ) {
    return undefined
  }
  return record.decision
}

function streamRun(context: Context, run: AgentRun) {
  return streamSSE(context, async (stream) => {
    stream.onAbort(run.detach)
    try {
      for await (const event of run.events) {
        const dto = event satisfies AgentRunEventDto
        await stream.writeSSE({ data: JSON.stringify(dto), event: dto.type })
      }
    } catch {
      run.detach()
    }
  })
}

/** 创建 Agent prompt、continue 与 abort Controller。 */
export function createAgentRunController(runtime: AgentRuntime) {
  return {
    abort: (context: Context) => {
      try {
        runtime.abort(context.req.param('id')!)
        return context.body(null, 204)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    pendingApproval: (context: Context) => {
      try {
        const approval = runtime.pendingApproval(context.req.param('id')!)
        if (!approval) return context.body(null, 204)
        return context.json(approval satisfies AgentRunEventDto)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    reconnect: (context: Context) => {
      try {
        const run = runtime.reconnect(context.req.param('id')!)
        return run ? streamRun(context, run) : context.body(null, 204)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    continue: async (context: Context) => {
      const input = await context.req.json<unknown>().catch(() => undefined)
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== 'permission') ||
        !isToolPermission((input as Record<string, unknown>).permission)
      ) {
        return context.json(
          { code: 'INVALID_RUN_PERMISSION', message: '运行权限无效。' },
          400,
        )
      }
      try {
        return streamRun(
          context,
          await runtime.continue(
            context.req.param('id')!,
            (input as { permission: SendAgentMessageDto['permission'] })
              .permission,
          ),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    prompt: async (context: Context) => {
      let input: SendAgentMessageDto | undefined
      try {
        input = await parsePromptRequest(context)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
      if (!input) {
        return context.json(
          {
            code: 'INVALID_SESSION_REQUEST',
            message: '消息、能力或附件内容无效。',
          },
          400,
        )
      }
      try {
        return streamRun(
          context,
          await runtime.prompt(
            context.req.param('id')!,
            input,
            input.permission,
          ),
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    resolveApproval: async (context: Context) => {
      const decision = parseApprovalDecision(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!decision) {
        return context.json(
          { code: 'INVALID_APPROVAL_REQUEST', message: '审批决议无效。' },
          400,
        )
      }
      try {
        await runtime.resolveApproval(
          context.req.param('id')!,
          context.req.param('approvalId')!,
          decision,
        )
        return context.body(null, 204)
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
  }
}
