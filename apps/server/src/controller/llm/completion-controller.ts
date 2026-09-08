import { ModelServiceError, type ModelService } from '@oh-my-harness/llm'
import type { Context } from 'hono'
import { COMPLETION_EVENT_TYPE, MESSAGE_ROLE } from '@oh-my-harness/shared'
import { streamSSE } from 'hono/streaming'

import type {
  CompletionEventDto,
  CompletionStreamRequestDto,
} from '../../dto/llm/completion-dto.ts'

function isCompletionRequest(
  value: unknown,
): value is CompletionStreamRequestDto {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<CompletionStreamRequestDto>
  return (
    typeof request.providerId === 'string' &&
    typeof request.modelId === 'string' &&
    Array.isArray(request.messages) &&
    request.messages.length > 0 &&
    request.messages.length <= 200 &&
    (request.systemPrompt === undefined ||
      (typeof request.systemPrompt === 'string' &&
        request.systemPrompt.length <= 100_000)) &&
    request.messages.every(
      (message) =>
        !!message &&
        (message.role === MESSAGE_ROLE.USER ||
          message.role === MESSAGE_ROLE.ASSISTANT) &&
        typeof message.content === 'string' &&
        message.content.length <= 1_000_000,
    )
  )
}

/** 创建无会话持久化的单次模型 SSE Controller。 */
export function createCompletionController(models: ModelService) {
  return async (context: Context) => {
    const request = await context.req.json<unknown>().catch(() => undefined)
    if (!isCompletionRequest(request)) {
      return context.json(
        { code: 'INVALID_COMPLETION_REQUEST', message: '模型请求无效。' },
        400,
      )
    }

    const controller = new AbortController()
    context.req.raw.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    })
    let events: Awaited<ReturnType<ModelService['stream']>>
    try {
      events = await models.stream(request, controller.signal)
    } catch (error) {
      if (error instanceof ModelServiceError) {
        return context.json(
          { code: error.code, message: error.message },
          error.status,
        )
      }
      return context.json(
        {
          code: 'MODEL_REQUEST_SETUP_FAILED',
          message: '模型调用初始化失败。',
        },
        500,
      )
    }

    return streamSSE(context, async (stream) => {
      stream.onAbort(() => controller.abort())

      const write = (event: CompletionEventDto) =>
        stream.writeSSE({ data: JSON.stringify(event), event: event.type })

      try {
        for await (const event of events) {
          if (event.type === COMPLETION_EVENT_TYPE.START)
            await write({ type: COMPLETION_EVENT_TYPE.START })
          else if (event.type === COMPLETION_EVENT_TYPE.TEXT_DELTA) {
            await write({
              delta: event.delta,
              type: COMPLETION_EVENT_TYPE.TEXT_DELTA,
            })
          } else if (event.type === 'thinking_delta') {
            await write({
              delta: event.delta,
              type: COMPLETION_EVENT_TYPE.REASONING_DELTA,
            })
          } else if (event.type === COMPLETION_EVENT_TYPE.DONE) {
            const usage = event.message.usage
            await write({
              input: usage.input,
              output: usage.output,
              total: usage.totalTokens,
              type: COMPLETION_EVENT_TYPE.USAGE,
            })
            await write({
              stopReason: event.reason,
              type: COMPLETION_EVENT_TYPE.DONE,
            })
          } else if (event.type === COMPLETION_EVENT_TYPE.ERROR) {
            await write({
              code: 'MODEL_REQUEST_FAILED',
              message: '模型调用失败。',
              type: COMPLETION_EVENT_TYPE.ERROR,
            })
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          await write({
            code: 'MODEL_REQUEST_FAILED',
            message: '模型调用失败。',
            type: COMPLETION_EVENT_TYPE.ERROR,
          })
        }
      }
    })
  }
}
