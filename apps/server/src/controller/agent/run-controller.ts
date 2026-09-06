import {
  isToolPermission,
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

import type {
  AgentRunEventDto,
  SendAgentMessageDto,
} from '../../dto/agent/run-dto.ts'
import { agentErrorResponse } from './error-response.ts'

const MAX_ATTACHMENTS = 5
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARACTERS = 200_000
const thinkingLevels = new Set<ModelThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
const textExtensions = new Set([
  'c',
  'cc',
  'conf',
  'cpp',
  'css',
  'csv',
  'go',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'log',
  'md',
  'mjs',
  'py',
  'rs',
  'sh',
  'sql',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
])

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
  return {
    ...(commandId ? { commandId } : {}),
    content: record.content,
    permission: record.permission,
    ...(skillIds?.length ? { skillIds } : {}),
    ...(record.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: record.thinkingLevel as ModelThinkingLevel }),
  }
}

const declaredText = (file: File) => {
  const extension = file.name.split('.').at(-1)?.toLocaleLowerCase() ?? ''
  return (
    file.type.startsWith('text/') ||
    [
      'application/json',
      'application/javascript',
      'application/toml',
      'application/xml',
      'application/x-yaml',
      'application/yaml',
    ].includes(file.type) ||
    textExtensions.has(extension)
  )
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

async function parseAttachments(files: File[]) {
  if (files.length > MAX_ATTACHMENTS) {
    throw new AgentRuntimeError('REQUEST_TOO_LARGE', '附件数量过多。', 413)
  }
  let totalBytes = 0
  let totalCharacters = 0
  const attachments: AgentRunAttachment[] = []
  for (const file of files) {
    if (!file.name || file.name.length > 255 || /[\\/\0]/u.test(file.name)) {
      return undefined
    }
    totalBytes += file.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new AgentRuntimeError('REQUEST_TOO_LARGE', '附件总大小过大。', 413)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const imageMimeType = detectedImageMimeType(bytes)
    if (imageMimeType) {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new AgentRuntimeError('REQUEST_TOO_LARGE', '图片附件过大。', 413)
      }
      attachments.push({
        content: Buffer.from(bytes).toString('base64'),
        kind: 'image',
        mimeType: imageMimeType,
        name: file.name,
        size: file.size,
      })
      continue
    }
    if (!declaredText(file)) return undefined
    if (file.size > MAX_TEXT_BYTES) {
      throw new AgentRuntimeError('REQUEST_TOO_LARGE', '文本附件过大。', 413)
    }
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return undefined
    }
    if (content.includes('\0')) return undefined
    totalCharacters += content.length
    if (totalCharacters > MAX_TEXT_CHARACTERS) {
      throw new AgentRuntimeError(
        'REQUEST_TOO_LARGE',
        '附件提取文本过长。',
        413,
      )
    }
    attachments.push({
      content,
      kind: 'text',
      mimeType: file.type || 'text/plain',
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
    (record.decision !== 'approve-once' && record.decision !== 'reject')
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
        if (approval.effect === 'execute') {
          return context.json({
            approvalId: approval.approvalId,
            input: { command: approval.command },
            kind: 'command',
            title: '允许 AI 助手运行这条命令吗？',
            toolCallId: approval.toolCallId,
            toolName: 'bash',
          })
        }
        const kind = approval.toolName === 'read' ? 'read' : 'edit'
        return context.json({
          approvalId: approval.approvalId,
          kind,
          path: approval.path,
          title: `允许 AI 助手${kind === 'read' ? '读取' : '修改'} ${approval.path} 吗？`,
          toolCallId: approval.toolCallId,
          toolName: approval.toolName,
        })
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
