import { POLICY_TOOL } from '@oh-my-harness/agent-policy/contracts'
import {
  MCP_RUNTIME_CONNECTION_STATUS,
  MCP_TRANSPORT,
} from '@oh-my-harness/shared'
import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  AgentTool,
  BeforeToolCallContext,
} from '@earendil-works/pi-agent-core'
import type {
  ToolPolicy,
  ToolPermission,
  PendingToolApproval,
  ApprovalResolution,
} from '@oh-my-harness/agent-policy'
import {
  type McpConnectionService,
  type McpConnectionTarget,
} from './auth/connection-service.ts'

export async function createMcpTools(options: {
  connections: McpConnectionService
  targets: McpConnectionTarget[]
  policy: ToolPolicy
  permission: ToolPermission
  runId: string
  sessionId: string
  signal: AbortSignal
  onApprovalRequested(approval: PendingToolApproval): Promise<void>
  onApprovalResolved(resolution: ApprovalResolution): Promise<void>
}) {
  const tools: AgentTool[] = []
  const startupDeadline = AbortSignal.timeout(30_000)
  const diagnostics: string[] = []
  const cleanups: (() => Promise<void>)[] = []
  const authorized = new Map<string, { name: string; input: string }>()
  const targets = new Map<
    string,
    {
      target: McpConnectionTarget
      rawName: string
      validate(input: unknown): { valid: boolean }
    }
  >()
  try {
    for (const target of options.targets) {
      options.signal.throwIfAborted()
      if (startupDeadline.aborted) {
        diagnostics.push(
          'MCP initialization budget exceeded; remaining connections were not started.',
        )
        break
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([options.signal, controller.signal])
      const client = new Client(
        { name: 'oh-my-harness', version: '1.0.0' },
        { capabilities: {} },
      )
      let release = () => {}
      const abort = () => {
        controller.abort()
        void client.close().catch(() => undefined)
      }
      const cleanup = async () => {
        signal.removeEventListener('abort', abort)
        release()
        await client.close().catch(() => undefined)
        options.connections.setNetworkState(
          target.id,
          MCP_RUNTIME_CONNECTION_STATUS.DISCONNECTED,
        )
      }
      cleanups.push(cleanup)
      const initialToolCount = tools.length
      try {
        const { config, generation } =
          await options.connections.configuration(target)
        const watcher = options.connections.watch(target, generation, abort)
        release = watcher.release
        signal.addEventListener('abort', abort, { once: true })
        options.connections.setNetworkState(
          target.id,
          MCP_RUNTIME_CONNECTION_STATUS.CONNECTING,
        )
        const transport =
          config.transport === MCP_TRANSPORT.STDIO
            ? new StdioClientTransport({
                command: config.command!,
                args: config.args,
                cwd: target.rootDirectory,
                env: {
                  PATH: process.env.PATH ?? '',
                  HOME: target.rootDirectory,
                  npm_config_offline: 'true',
                  npm_config_yes: 'false',
                  ...config.env,
                },
                stderr: 'ignore',
                maxBufferSize: 8 * 1024 * 1024,
              })
            : new StreamableHTTPClientTransport(new URL(config.url!), {
                fetch: await options.connections.requestFetch(
                  target,
                  generation,
                ),
                requestInit: { headers: config.headers },
                reconnectionOptions: {
                  maxRetries: 0,
                  initialReconnectionDelay: 1000,
                  maxReconnectionDelay: 1000,
                  reconnectionDelayGrowFactor: 1,
                },
              })
        const startupSignal = AbortSignal.any([signal, startupDeadline])
        await client.connect(transport, {
          signal: startupSignal,
          timeout: 15_000,
        })
        const discovered = []
        let cursor: string | undefined
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, {
            signal: startupSignal,
            timeout: 15_000,
          })
          discovered.push(...page.tools)
          if (discovered.length > 200 || (cursor && cursor === page.nextCursor))
            throw new Error('MCP 工具目录超限')
          cursor = page.nextCursor
        } while (cursor)
        const names = new Set<string>()
        for (const remote of discovered) {
          if (
            tools.length >= 200 ||
            names.has(remote.name) ||
            remote.name.length > 200 ||
            JSON.stringify(remote.inputSchema).length > 32_000
          )
            throw new Error('MCP 工具定义无效')
          names.add(remote.name)
          const safeRemote = await options.connections.redact(target.id, remote)
          if (safeRemote.name !== remote.name)
            throw new Error('MCP 工具名称包含凭据')
          const name = `mcp_${createHash('sha256').update(`${target.id}:${remote.name}`).digest('hex').slice(0, 24)}`
          const validate = new AjvJsonSchemaValidator().getValidator(
            remote.inputSchema,
          )
          targets.set(name, { target, rawName: remote.name, validate })
          tools.push({
            name,
            label: `${target.definition.name}: ${remote.name}`,
            description: `${target.definition.name}/${remote.name}: ${(safeRemote.description ?? '').slice(0, 4000)}`,
            parameters:
              safeRemote.inputSchema as unknown as AgentTool['parameters'],
            async execute(callId, args, callSignal) {
              const approval = authorized.get(callId)
              authorized.delete(callId)
              if (
                !approval ||
                approval.name !== name ||
                approval.input !== JSON.stringify(args)
              )
                throw new Error('MCP 调用没有匹配的单次授权')
              await watcher.check()
              const activeSignal = AbortSignal.any([
                signal,
                ...(callSignal ? [callSignal] : []),
              ])
              activeSignal.throwIfAborted()
              try {
                const result = await client.callTool(
                  {
                    name: remote.name,
                    arguments: args as Record<string, unknown>,
                  },
                  undefined,
                  { signal: activeSignal, timeout: 60_000 },
                )
                const content =
                  'content' in result && Array.isArray(result.content)
                    ? result.content.flatMap((item) => {
                        if (
                          item.type === 'text' &&
                          typeof item.text === 'string'
                        )
                          return [
                            {
                              type: 'text' as const,
                              text: item.text.slice(0, 200_000),
                            },
                          ]
                        if (item.type === 'resource_link')
                          return [
                            {
                              type: 'text' as const,
                              text: JSON.stringify({
                                name: item.name,
                                uri: item.uri,
                                description: item.description,
                              }),
                            },
                          ]
                        if (
                          item.type === 'resource' &&
                          typeof item.resource?.text === 'string'
                        )
                          return [
                            {
                              type: 'text' as const,
                              text: item.resource.text.slice(0, 200_000),
                            },
                          ]
                        return [
                          {
                            type: 'text' as const,
                            text: `[MCP ${item.type} content not rendered]`,
                          },
                        ]
                      })
                    : [
                        {
                          type: 'text' as const,
                          text: JSON.stringify(result).slice(0, 200_000),
                        },
                      ]
                if (result.isError)
                  throw new Error(
                    content
                      .map((item) => item.text)
                      .join('\n')
                      .slice(0, 4000),
                  )
                return {
                  content: await options.connections.redact(target.id, content),
                  details: {
                    connectionId: target.id,
                    remoteToolName: remote.name,
                  },
                }
              } catch {
                throw new Error(
                  'MCP 调用失败或已取消；结果可能未知，未自动重试。请检查插件连接后再决定是否重试。',
                )
              }
            },
          })
        }
        options.connections.setNetworkState(
          target.id,
          MCP_RUNTIME_CONNECTION_STATUS.READY,
        )
      } catch {
        for (const tool of tools.splice(initialToolCount))
          targets.delete(tool.name)
        await cleanup()
        options.connections.setNetworkState(
          target.id,
          MCP_RUNTIME_CONNECTION_STATUS.ERROR,
          '需要配置、登录或连接失败，请检查插件设置',
        )
        diagnostics.push(
          `${target.definition.name}: MCP unavailable; check plugin connection settings. No calls were retried.`,
        )
      }
    }
  } catch (error) {
    await Promise.allSettled(cleanups.map((cleanup) => cleanup()))
    throw error
  }
  return {
    tools,
    diagnostics,
    owns: (name: string) => targets.has(name),
    beforeToolCall: async (
      call: BeforeToolCallContext,
      signal?: AbortSignal,
    ) => {
      const mapping = targets.get(call.toolCall.name)
      authorized.delete(call.toolCall.id)
      if (
        !mapping ||
        !call.args ||
        typeof call.args !== 'object' ||
        Array.isArray(call.args) ||
        JSON.stringify(call.args).length > 100_000 ||
        !mapping.validate(call.args).valid
      )
        return { block: true, reason: 'MCP 工具参数无效' }
      try {
        await options.policy.authorize(
          {
            ...POLICY_TOOL.MCP,
            connectionId: mapping.target.id,
            remoteToolName: mapping.rawName,
            input: call.args as Record<string, unknown>,
            permission: options.permission,
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: call.toolCall.id,
          },
          {
            onRequested: options.onApprovalRequested,
            onResolved: options.onApprovalResolved,
          },
          signal,
        )
        signal?.throwIfAborted()
        authorized.set(call.toolCall.id, {
          name: call.toolCall.name,
          input: JSON.stringify(call.args),
        })
        return undefined
      } catch {
        return { block: true, reason: 'MCP 调用未获批准或已取消' }
      }
    },
    cleanup: async () => {
      authorized.clear()
      await Promise.allSettled(cleanups.map((cleanup) => cleanup()))
    },
  }
}
