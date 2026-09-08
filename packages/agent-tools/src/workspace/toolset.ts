import {
  FILE_SCOPE,
  POLICY_TOOL,
  TOOL_PERMISSION,
  getFileTool,
} from '@oh-my-harness/agent-policy/contracts'
import { relative } from 'node:path'
import type {
  ApprovalResolution,
  PendingToolApproval,
  ToolPermission,
} from '@oh-my-harness/agent-policy'
import { ToolPolicy, ToolPolicyError } from '@oh-my-harness/agent-policy'
import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'

import { createBashTool, parseBashInput } from '../tools/bash.ts'
import { createEditTool } from '../tools/edit.ts'
import { createReadTool } from '../tools/read.ts'
import { createWriteTool } from '../tools/write.ts'
import { WorkspaceExecutionEnv } from './execution-env.ts'

interface WorkspaceToolsOptions {
  cwd: string
  onApprovalRequested(approval: PendingToolApproval): Promise<void>
  onApprovalResolved(resolution: ApprovalResolution): Promise<void>
  permission: ToolPermission
  policy: ToolPolicy
  protectedRoots?: readonly string[]
  runId: string
  sessionId: string
}

type FileTarget = Awaited<
  ReturnType<WorkspaceExecutionEnv['resolveToolTarget']>
>
interface AuthorizedCall {
  input: string
  toolName: string
  target?: FileTarget
}

/** 为一次 Run 绑定 Policy；执行只消费同 ID、同参数的一次授权。 */
export const createWorkspaceTools = async (options: WorkspaceToolsOptions) => {
  const env = await WorkspaceExecutionEnv.create(
    options.cwd,
    options.protectedRoots,
  )
  const authorized = new Map<string, AuthorizedCall>()
  const fileToolMap = {
    [POLICY_TOOL.READ.toolName]: createReadTool(),
    [POLICY_TOOL.WRITE.toolName]: createWriteTool(),
    [POLICY_TOOL.EDIT.toolName]: createEditTool(),
  }
  for (const [name, tool] of Object.entries(fileToolMap)) {
    if (tool.name !== name)
      throw new ToolPolicyError(
        'TOOL_PERMISSION_DENIED',
        'SDK 工具名称与宿主契约不一致。',
      )
  }
  const fileTools = Object.values(fileToolMap)
  const bash = createBashTool(
    env.cwd,
    options.permission === TOOL_PERMISSION.FULL_ACCESS,
  )
  const tools: AgentTool[] = [...fileTools, bash].map((tool) => ({
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const call = authorized.get(toolCallId)
      authorized.delete(toolCallId)
      signal?.throwIfAborted()
      if (
        !call ||
        call.toolName !== tool.name ||
        call.input !== JSON.stringify(params)
      ) {
        throw new ToolPolicyError(
          'TOOL_PERMISSION_DENIED',
          '工具调用没有匹配的单次授权。',
        )
      }
      if (!call.target)
        return bash.execute(toolCallId, params, signal, onUpdate)
      const input = params as Record<string, unknown>
      const current = await env.resolveToolTarget(input.path as string)
      if (current.path !== call.target.path) {
        throw new ToolPolicyError(
          'TOOL_PERMISSION_DENIED',
          '审批后文件目标已变化，请重新发起调用。',
        )
      }
      const definition = getFileTool(tool.name)
      if (!definition)
        throw new ToolPolicyError(
          'TOOL_PERMISSION_DENIED',
          '文件工具不在允许范围内。',
        )
      const scopedEnv = env.forTarget(call.target, definition.effect)
      try {
        const fileTool = fileToolMap[definition.toolName]
        const result = await fileTool.execute(
          toolCallId,
          { ...input, path: call.target.path } as never,
          signal,
          onUpdate,
          { env: scopedEnv },
        )
        return {
          ...result,
          details: {
            ...(result.details && typeof result.details === 'object'
              ? result.details
              : {}),
            fileTarget: {
              scope: call.target.scope,
              path:
                call.target.scope === FILE_SCOPE.WORKSPACE
                  ? relative(env.cwd, call.target.path)
                  : call.target.path,
            },
          },
        }
      } finally {
        await scopedEnv.cleanup()
      }
    },
  }))

  const beforeToolCall = async (
    call: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    authorized.delete(call.toolCall.id)
    const toolName = call.toolCall.name
    const input = JSON.stringify(call.args)
    const common = {
      permission: options.permission,
      runId: options.runId,
      sessionId: options.sessionId,
      toolCallId: call.toolCall.id,
    }
    const hooks = {
      onRequested: options.onApprovalRequested,
      onResolved: options.onApprovalResolved,
    }
    try {
      signal?.throwIfAborted()
      if (toolName === POLICY_TOOL.BASH.toolName) {
        const { command } = parseBashInput(call.args)
        await options.policy.authorize(
          { ...common, ...POLICY_TOOL.BASH, command },
          hooks,
          signal,
        )
        signal?.throwIfAborted()
        authorized.set(call.toolCall.id, { input, toolName })
        return
      }
      const definition = getFileTool(toolName)
      if (!definition) {
        return { block: true, reason: '工具不在允许范围内。' }
      }
      const args = call.args as Record<string, unknown> | null
      if (!args || typeof args.path !== 'string')
        return { block: true, reason: '文件参数无效。' }
      const target = await env.resolveToolTarget(args.path)
      await options.policy.authorize(
        {
          ...common,
          ...definition,
          scope: target.scope,
          path:
            target.scope === FILE_SCOPE.WORKSPACE
              ? relative(env.cwd, target.path) || '.'
              : target.path,
        },
        hooks,
        signal,
      )
      signal?.throwIfAborted()
      authorized.set(call.toolCall.id, { input, target, toolName })
      return
    } catch (error) {
      return {
        block: true,
        reason:
          error instanceof ToolPolicyError
            ? error.message
            : toolName === POLICY_TOOL.BASH.toolName
              ? '命令无效或已取消。'
              : '文件路径无效、受保护或调用已取消。',
      }
    }
  }

  return {
    beforeToolCall,
    cleanup: () => {
      authorized.clear()
      return env.cleanup()
    },
    tools,
  }
}
