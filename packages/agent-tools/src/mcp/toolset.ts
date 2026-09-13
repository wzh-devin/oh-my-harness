import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import {
  TOOL_EFFECT,
  type ToolPermission,
  type ToolPolicy,
  type PendingToolApproval,
  type ApprovalResolution,
  type McpToolIdentity,
} from '@oh-my-harness/agent-policy'
import { McpService } from './service.ts'
import { redactMcpValue } from './config.ts'

interface McpRunOptions {
  service: McpService
  permission: ToolPermission
  policy: ToolPolicy
  runId: string
  sessionId: string
  signal: AbortSignal
  supportsImages: boolean
  onApprovalRequested(approval: PendingToolApproval): Promise<void>
  onApprovalResolved(resolution: ApprovalResolution): Promise<void>
}

/** 把 MCP 工具目录适配为 Run 工具，授权和执行只消费精确匹配的一次调用。 */
export const createMcpTools = async (options: McpRunOptions) => {
  const { bindings, unavailable } = await options.service.snapshot()
  const validators = new AjvJsonSchemaValidator()
  const registry = new Map<string, McpToolIdentity>()
  const authorized = new Map<
    string,
    { name: string; input: string; lease: ReturnType<McpService['lease']> }
  >()
  const tools: AgentTool[] = []
  for (const binding of bindings) {
    let validate: ReturnType<AjvJsonSchemaValidator['getValidator']>
    try {
      validate = validators.getValidator(binding.tool.inputSchema)
    } catch {
      unavailable.push(
        `${binding.serverName} · ${binding.tool.name}（参数定义不支持）`,
      )
      continue
    }
    const identity: McpToolIdentity = {
      toolName: binding.name,
      serverId: binding.serverId,
      serverName: binding.serverName,
      originalToolName: binding.tool.name,
      revision: binding.revision,
      toolVersion: binding.toolVersion,
    }
    registry.set(binding.name, identity)
    tools.push({
      name: binding.name,
      label: `${binding.serverName} · ${binding.tool.name}`,
      description: `MCP 服务 ${binding.serverName} 的 ${binding.tool.name}。${binding.tool.description ?? ''}`,
      parameters: binding.tool.inputSchema,
      prepareArguments: (args: unknown) => {
        if (!validate(args).valid)
          throw new Error('MCP 工具参数不符合声明的 JSON Schema。')
        return args as Record<string, unknown>
      },
      async execute(callId, params, signal) {
        const call = authorized.get(callId)
        authorized.delete(callId)
        if (
          !call ||
          call.name !== binding.name ||
          call.input !== JSON.stringify(params)
        ) {
          call?.lease.release()
          throw new Error('MCP 调用没有匹配的单次授权。')
        }
        try {
          signal?.throwIfAborted()
          const result = await call.lease.execute(
            params as Record<string, unknown>,
          )
          const content: Awaited<ReturnType<AgentTool['execute']>>['content'] =
            []
          for (const block of result.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string')
              content.push({ type: 'text', text: block.text })
            else if (
              block.type === 'image' &&
              options.supportsImages &&
              typeof block.data === 'string' &&
              typeof block.mimeType === 'string' &&
              ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
                block.mimeType,
              )
            )
              content.push({
                type: 'image',
                data: block.data,
                mimeType: block.mimeType,
              })
            else
              content.push({
                type: 'text',
                text: `MCP 返回了当前不支持的内容类型 ${block.type}，未自动下载或转换。`,
              })
          }
          if (result.structuredContent)
            content.push({
              type: 'text',
              text: JSON.stringify(result.structuredContent),
            })
          if (!content.length)
            content.push({
              type: 'text',
              text: 'MCP 工具执行完成，未返回内容。',
            })
          if (result.isError)
            throw new Error(
              content
                .filter((item) => item.type === 'text')
                .map((item) => item.text)
                .join('\n')
                .slice(0, 16000),
            )
          return {
            content,
            details: {
              displayName: `${binding.serverName} · ${binding.tool.name}`,
            },
          }
        } finally {
          call.lease.release()
        }
      },
    })
  }

  const beforeToolCall = async (
    call: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const identity = registry.get(call.toolCall.name)
    const binding = bindings.find(
      (binding) => binding.name === call.toolCall.name,
    )
    if (!identity || !binding)
      return { block: true, reason: 'MCP 工具未登记在本轮工具目录中。' }
    authorized.get(call.toolCall.id)?.lease.release()
    authorized.delete(call.toolCall.id)
    let lease: ReturnType<McpService['lease']> | undefined
    try {
      lease = options.service.lease(
        binding,
        options.sessionId,
        AbortSignal.any([options.signal, ...(signal ? [signal] : [])]),
      )
      await options.policy.authorize(
        {
          ...identity,
          effect: TOOL_EFFECT.MCP_CALL,
          permission: options.permission,
          runId: options.runId,
          sessionId: options.sessionId,
          toolCallId: call.toolCall.id,
          input: redactMcpValue(call.args as Record<string, unknown>, []),
        },
        {
          onRequested: options.onApprovalRequested,
          onResolved: options.onApprovalResolved,
        },
        lease.signal,
        registry,
      )
      lease.signal.throwIfAborted()
      authorized.set(call.toolCall.id, {
        name: binding.name,
        input: JSON.stringify(call.args),
        lease,
      })
    } catch {
      lease?.release()
      return { block: true, reason: 'MCP 调用被拒绝、取消，或服务配置已变化。' }
    }
  }
  return {
    tools,
    unavailable,
    has: (name: string) => registry.has(name),
    beforeToolCall,
    cleanup: async () => {
      authorized.forEach((call) => call.lease.release())
      authorized.clear()
    },
  }
}
