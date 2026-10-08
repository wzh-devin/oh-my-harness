import {
  RUN_RECOVERY_ACTION,
  RUN_STATUS,
  type RunRecoveryAction,
  type RunStatus,
} from '@oh-my-harness/shared'
import type { Context } from 'hono'

import type {
  AgentRunPageDto,
  RecoverAgentRunResponseDto,
} from '../../dto/agent/run-summary-dto.ts'
import type { SandboxSettingsService } from '../../infrastructure/settings/sandbox-settings-service.ts'
import { agentErrorResponse } from './error-response.ts'
import type { AgentRuntime } from '@oh-my-harness/agent-runtime'

const statuses = new Set<RunStatus>(Object.values(RUN_STATUS))
const actions = new Set<RunRecoveryAction>(Object.values(RUN_RECOVERY_ACTION))

function parseListQuery(context: Context) {
  const limit = Number(context.req.query('limit') ?? 50)
  const cursor = context.req.query('cursor')
  const status = context.req.query('status') as RunStatus | undefined
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (status !== undefined && !statuses.has(status)) ||
    (cursor !== undefined && (!cursor || cursor.length > 512))
  ) {
    return undefined
  }
  return { limit, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) }
}

function parseAction(value: unknown): RunRecoveryAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 &&
    actions.has(record.action as RunRecoveryAction)
    ? (record.action as RunRecoveryAction)
    : undefined
}

/** 提供跨会话 Run 查询和恢复动作。 */
export function createRunSummaryController(
  runtime: AgentRuntime,
  sandboxSettings: SandboxSettingsService,
) {
  return {
    list: async (context: Context) => {
      const query = parseListQuery(context)
      if (!query) {
        return context.json(
          { code: 'INVALID_RUN_QUERY', message: '运行查询参数无效。' },
          400,
        )
      }
      try {
        return context.json(
          (await runtime.listRuns(query)) satisfies AgentRunPageDto,
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
    recover: async (context: Context) => {
      const action = parseAction(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!action) {
        return context.json(
          { code: 'INVALID_RECOVERY_ACTION', message: '恢复动作无效。' },
          400,
        )
      }
      try {
        const sandbox = await sandboxSettings.get()
        const result = await runtime.recoverRun(
          context.req.param('runId')!,
          action,
          sandbox.mode,
          sandbox.supported,
        )
        result.run.detach()
        return context.json(
          {
            action: result.action,
            runId: result.runId,
            runRequired: true,
            sessionId: result.sessionId,
          } satisfies RecoverAgentRunResponseDto,
          202,
        )
      } catch (error) {
        return agentErrorResponse(context, error)
      }
    },
  }
}
