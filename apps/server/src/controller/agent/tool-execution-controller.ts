import type { AgentRuntime } from '@oh-my-harness/agent-runtime'
import { TOOL_EXECUTION_EVENT_TYPE } from '@oh-my-harness/shared'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { ToolExecutionEventDto } from '../../dto/agent/tool-execution-dto.ts'
import { agentErrorResponse } from './error-response.ts'

const parseOutputQuery = (context: Context) => {
  const offset = context.req.query('offset') ?? '0'
  const limit = context.req.query('limit') ?? '16000'
  if (!/^\d+$/u.test(offset) || !/^\d+$/u.test(limit)) return
  const parsed = { offset: Number(offset), limit: Number(limit) }
  return Number.isSafeInteger(parsed.offset) &&
    Number.isSafeInteger(parsed.limit) &&
    parsed.limit >= 1 &&
    parsed.limit <= 256 * 1024
    ? parsed
    : undefined
}

/** 暴露绑定当前会话的执行目录、输出与生命周期操作。 */
export const createToolExecutionController = (runtime: AgentRuntime) => ({
  removeService: async (context: Context) => {
    try {
      return context.json(
        await runtime.removeService(
          context.req.param('id')!,
          context.req.param('executionId')!,
        ),
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  get: async (context: Context) => {
    try {
      return context.json(
        await runtime.getExecution(
          context.req.param('id')!,
          context.req.param('executionId')!,
        ),
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  list: async (context: Context) => {
    try {
      return context.json(
        await runtime.listExecutions(context.req.param('id')!),
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  output: async (context: Context) => {
    const query = parseOutputQuery(context)
    if (!query)
      return context.json(
        { code: 'INVALID_TOOL_OUTPUT_REQUEST', message: '输出读取参数无效。' },
        400,
      )
    try {
      return context.json(
        await runtime.readExecutionOutput(
          context.req.param('id')!,
          context.req.param('executionId')!,
          query.offset,
          query.limit,
        ),
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  restart: async (context: Context) => {
    try {
      return context.json(
        await runtime.restartExecution(
          context.req.param('id')!,
          context.req.param('executionId')!,
        ),
        201,
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  stop: async (context: Context) => {
    try {
      return context.json(
        await runtime.stopExecution(
          context.req.param('id')!,
          context.req.param('executionId')!,
        ),
      )
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  },
  stream: async (context: Context) => {
    const sessionId = context.req.param('id')!
    try {
      await runtime.listExecutions(sessionId)
    } catch (error) {
      return agentErrorResponse(context, error)
    }
    return streamSSE(context, async (stream) => {
      let unsubscribe: (() => void) | undefined
      let finish!: () => void
      const closed = new Promise<void>((resolve) => {
        finish = resolve
      })
      let writes = Promise.resolve()
      const close = () => {
        unsubscribe?.()
        finish()
      }
      stream.onAbort(close)
      const send = (event: ToolExecutionEventDto) => {
        writes = writes
          .then(() =>
            stream.writeSSE({ data: JSON.stringify(event), event: event.type }),
          )
          .catch(close)
      }
      try {
        unsubscribe = await runtime.subscribeExecutions(
          sessionId,
          (execution) => {
            const event = {
              execution,
              type: TOOL_EXECUTION_EVENT_TYPE.EXECUTION,
            } satisfies ToolExecutionEventDto
            send(event)
          },
          (executions) =>
            send({ executions, type: TOOL_EXECUTION_EVENT_TYPE.SNAPSHOT }),
        )
        if (stream.aborted) close()
        await closed
        await writes
      } catch {
        close()
      }
    })
  },
})
