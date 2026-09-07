import { TOOL_PERMISSION } from '@oh-my-harness/agent-policy/contracts'
import {
  getToolActivityKind,
  toToolApprovalEvent,
} from '../execution/tool-presentation.ts'
import { randomUUID } from 'node:crypto'
import { PluginError, type PluginService } from '@oh-my-harness/agent-plugins'

import {
  ToolPolicy,
  ToolPolicyError,
  isToolPermission,
  type ApprovalDecision,
  type ApprovalResolution,
  type PendingToolApproval,
  type ToolPermission,
} from '@oh-my-harness/agent-policy'
import {
  BUILTIN_TOOL_NAME,
  createAttachmentTool,
  createSkillResourceTool,
  createTodoWriteTool,
  createWorkspaceTools,
  createMcpTools,
  pluginConnectionTargets,
  type McpConnectionService,
} from '@oh-my-harness/agent-tools'
import { ModelServiceError, type ModelService } from '@oh-my-harness/llm'
import {
  Agent,
  buildSessionContext,
  createCustomMessage,
  type AgentEvent,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import {
  EventStream,
  getSupportedThinkingLevels,
  type AssistantMessage,
  type TextContent,
  type UserMessage,
} from '@earendil-works/pi-ai'

import { AgentCapabilityService } from '../capability/capability-service.ts'
import { compactSessionIfNeeded } from '../compaction/session-compaction.ts'
import { AgentRuntimeError } from '../error/agent-runtime-error.ts'
import { toolFilePath } from '../execution/tool-file-path.ts'
import {
  attachmentManifest,
  attachmentResourcesFromEntries,
  convertAttachmentMessagesToLlm,
} from '../execution/attachment-message.ts'
import { safeBashOutcome } from '../execution/bash-outcome.ts'
import {
  calculateContextUsage,
  persistedContextUsageSnapshot,
} from '../execution/context-usage.ts'
import {
  buildSystemPrompt,
  buildRuntimeContext,
  buildAvailableSkillsPrompt,
  buildSelectedPluginsPrompt,
  buildCurrentTodosPrompt,
  escapePromptXml,
} from '../prompt/system-prompt.ts'
import {
  projectAgentTrajectory,
  redactTrajectoryValue,
} from '../trajectory/agent-trajectory.ts'
import { TrajectoryStream } from '../trajectory/trajectory-stream.ts'
import type { AgentRun, AgentRuntimeEvent } from '../execution/runtime-event.ts'
import type {
  AgentMessageAttachment,
  AgentMessageContextItem,
  AgentRunAttachment,
  AgentRunInput,
} from '../execution/run-input.ts'
import {
  AgentSessionService,
  projectRecoverableTodos,
  type AgentSessionInfo,
  type AgentSessionProjection,
  type AgentSessionRepository,
} from '../session/session-service.ts'
import { SESSION_CUSTOM_TYPE } from '../session/session-custom-type.ts'

interface ActiveOperation {
  trajectory?: TrajectoryStream
  agent?: Agent
  controller: AbortController
  events?: ActiveRunEventChannel
  finish(): void
  kind: 'mutation' | 'run'
  settled: Promise<void>
}

interface AgentRuntimeToolOptions {
  plugins?: PluginService
  connections?: McpConnectionService
  dataDirectory?: string
  policy: ToolPolicy
  protectedRoots?: readonly string[]
}

/** 向每个已连接消费者广播活跃 Run 事件，断开只移除当前订阅。 */
class ActiveRunEventChannel {
  readonly permission: ToolPermission

  constructor(permission: ToolPermission) {
    this.permission = permission
  }

  private readonly subscribers = new Set<EventStream<AgentRuntimeEvent, void>>()

  subscribe(initialEvent?: AgentRuntimeEvent): AgentRun {
    const events = new EventStream<AgentRuntimeEvent, void>(
      (event) => event.type === 'done' || event.type === 'error',
      () => undefined,
    )
    this.subscribers.add(events)
    if (initialEvent) events.push(initialEvent)
    if (initialEvent) events.push({ type: 'trajectory_changed' })
    return {
      detach: () => {
        this.subscribers.delete(events)
        events.end()
      },
      events,
    }
  }

  push(event: AgentRuntimeEvent) {
    for (const subscriber of this.subscribers) subscriber.push(event)
  }

  end() {
    for (const subscriber of this.subscribers) subscriber.end()
    this.subscribers.clear()
  }
}

function createUserMessage(content: string): UserMessage {
  return {
    content: [{ text: content, type: 'text' }],
    role: 'user',
    timestamp: Date.now(),
  }
}

const buildStructuredUserPrompt = (input: AgentRunInput) => {
  const content: TextContent[] = []
  if (input.content) {
    content.push({ text: input.content, type: 'text' })
  }
  const attachments: (AgentMessageAttachment & AgentRunAttachment)[] = []
  for (const attachment of input.attachments ?? []) {
    const contentIndex = attachments.length
    attachments.push({
      ...attachment,
      contentIndex,
      id: randomUUID(),
    })
  }
  if (attachments.length) content.push(attachmentManifest(attachments))
  return { attachments, content }
}

function toDurableMessage(message: AgentMessage, aborted: boolean) {
  // Pi Agent 0.84.3 会保留可选 undefined 字段，而 Session payload 只接受 JSON 值。
  const durable = JSON.parse(JSON.stringify(message)) as AgentMessage
  if (durable.role === 'assistant' && aborted) {
    durable.stopReason = 'aborted'
    delete durable.errorMessage
  }
  return durable
}

function runtimeEventError(
  error: unknown,
): Extract<AgentRuntimeEvent, { type: 'error' }> {
  if (error instanceof AgentRuntimeError) {
    return { code: error.code, message: error.message, type: 'error' }
  }
  return {
    code: 'AGENT_RUN_FAILED',
    message: 'Agent 运行失败。',
    type: 'error',
  }
}

function safeToolInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const values = input as Record<string, unknown>
  const attachmentId = values.attachmentId
  if (typeof attachmentId === 'string') {
    return attachmentId && !attachmentId.includes('\0')
      ? { attachmentId }
      : { attachmentId: '[blocked id]' }
  }
  if (typeof values.command === 'string') {
    return values.command &&
      !values.command.includes('\0') &&
      Buffer.byteLength(values.command) <= 32 * 1024
      ? { command: values.command }
      : { command: '[blocked command]' }
  }
  const path = values.path
  if (
    typeof path !== 'string' ||
    path.includes('\0') ||
    path === '~' ||
    path.startsWith('~/') ||
    path.startsWith('file:')
  ) {
    return typeof path === 'string' ? { path: '[blocked path]' } : {}
  }
  return { path }
}

/** 协调 Pi Agent 与 Session 生命周期。 */
export class AgentRuntime {
  private readonly active = new Map<string, ActiveOperation>()
  private readonly capabilities?: AgentCapabilityService
  private readonly models: ModelService
  private readonly sessions: AgentSessionService
  private readonly toolOptions?: AgentRuntimeToolOptions
  private closed = false

  constructor(
    models: ModelService,
    repository: AgentSessionRepository,
    projection?: AgentSessionProjection,
    toolOptions?: AgentRuntimeToolOptions,
  ) {
    this.models = models
    this.sessions = new AgentSessionService(repository, projection)
    this.toolOptions = toolOptions
    this.capabilities = toolOptions?.dataDirectory
      ? new AgentCapabilityService(
          toolOptions.dataDirectory,
          toolOptions.plugins,
        )
      : undefined
  }

  async createSession(input: {
    cwd: string
    modelId: string
    name?: string
    providerId: string
  }) {
    this.assertOpen()
    await this.models.resolveModel(input.providerId, input.modelId)
    return this.sessions.create(input)
  }

  async listSessions() {
    this.assertOpen()
    return this.sessions.list()
  }

  async getSession(id: string) {
    this.assertOpen()
    return this.sessions.get(id)
  }

  async renameSession(id: string, name: string | undefined) {
    this.assertOpen()
    const operation = this.reserve(id, 'mutation')
    try {
      return await this.sessions.rename(id, name)
    } finally {
      this.release(id, operation)
    }
  }

  async archiveSession(id: string, archived: boolean) {
    this.assertOpen()
    const operation = this.reserve(id, 'mutation')
    try {
      return await this.sessions.archive(id, archived)
    } finally {
      this.release(id, operation)
    }
  }

  async updateSessionModel(
    id: string,
    input: { modelId: string; providerId: string },
  ) {
    this.assertOpen()
    const operation = this.reserve(id, 'mutation')
    try {
      await this.models.resolveModel(input.providerId, input.modelId)
      return await this.sessions.updateModel(id, input)
    } finally {
      this.release(id, operation)
    }
  }

  async getMessages(id: string, options: { before?: number; limit: number }) {
    this.assertOpen()
    if (!this.active.has(id)) {
      const opened = await this.sessions.open(id)
      await this.repairInterruptedTools(opened.session, opened.entries, id)
    }
    return this.sessions.messages(id, options)
  }

  async getTrajectory(id: string) {
    this.assertOpen()
    const snapshot = this.active.get(id)?.trajectory?.snapshot
    if (snapshot) return snapshot
    return this.sessions.trajectory(id, this.active.get(id)?.kind === 'run')
  }

  async getTrajectoryRecord(id: string, recordId: string) {
    this.assertOpen()
    const record = this.active
      .get(id)
      ?.trajectory?.snapshot?.records.find((item) => item.id === recordId)
    if (record) return record
    return this.sessions.trajectoryRecord(
      id,
      recordId,
      this.active.get(id)?.kind === 'run',
    )
  }

  async listCapabilities(id: string) {
    this.assertOpen()
    const session = await this.sessions.get(id)
    return this.listCapabilitiesForWorkspace(session.cwd)
  }

  async listCapabilitiesForWorkspace(cwd: string) {
    this.assertOpen()
    return (
      this.capabilities?.list(cwd) ?? {
        plugins: [],
        commands: [],
        diagnostics: [],
        skills: [],
      }
    )
  }

  async getAttachment(id: string, entryId: string, contentIndex: number) {
    this.assertOpen()
    return this.sessions.attachment(id, entryId, contentIndex)
  }

  async deleteSession(id: string) {
    this.assertOpen()
    const operation = this.reserve(id, 'mutation')
    try {
      await this.sessions.delete(id)
    } finally {
      this.release(id, operation)
    }
  }

  async deleteArchivedSessions() {
    this.assertOpen()
    return this.deleteSessionsWhere((session) => session.archived)
  }

  async deleteSessionsByCwd(cwd: string) {
    this.assertOpen()
    return this.deleteSessionsWhere((session) => session.cwd === cwd)
  }

  prompt(
    id: string,
    input: AgentRunInput | string,
    permission: ToolPermission = TOOL_PERMISSION.readOnly,
  ) {
    return this.startRun(
      id,
      permission,
      typeof input === 'string' ? { content: input } : input,
    )
  }

  continue(id: string, permission: ToolPermission = TOOL_PERMISSION.readOnly) {
    return this.startRun(id, permission)
  }

  /** 恢复与 SSE 同源的当前审批视图，不复制授权状态。 */
  pendingApproval(id: string) {
    this.assertOpen()
    const approval = this.toolOptions?.policy.pendingForSession(id)[0]
    return approval ? toToolApprovalEvent(approval) : undefined
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) {
    this.assertOpen()
    if (!this.toolOptions) {
      throw new AgentRuntimeError(
        'APPROVAL_NOT_FOUND',
        '待审批工具调用不存在。',
        404,
      )
    }
    try {
      await this.toolOptions.policy.resolveApproval(id, approvalId, decision)
    } catch (error) {
      if (error instanceof ToolPolicyError) {
        const status =
          error.code === 'APPROVAL_NOT_FOUND'
            ? 404
            : error.code === 'APPROVAL_ALREADY_RESOLVED'
              ? 409
              : 500
        throw new AgentRuntimeError(error.code, error.message, status)
      }
      throw error
    }
  }

  /** 为刷新后的页面重新订阅当前活跃 Run；无活跃 Run 时返回 undefined。 */
  reconnect(id: string) {
    this.assertOpen()
    const operation = this.active.get(id)
    return operation?.kind === 'run' && operation.events
      ? operation.events.subscribe({
          permission: operation.events.permission,
          sessionId: id,
          type: 'start',
        })
      : undefined
  }

  abort(id: string) {
    this.assertOpen()
    const operation = this.active.get(id)
    if (!operation || operation.kind !== 'run') {
      throw new AgentRuntimeError(
        'NO_ACTIVE_RUN',
        '当前会话没有正在运行的任务。',
        409,
      )
    }
    operation.controller.abort()
    operation.agent?.abort()
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const operations = [...this.active.values()]
    for (const operation of operations) {
      operation.controller.abort()
      operation.agent?.abort()
    }
    await Promise.allSettled(operations.map((operation) => operation.settled))
  }

  private async startRun(
    id: string,
    permission: ToolPermission,
    input?: AgentRunInput,
  ): Promise<AgentRun> {
    this.assertOpen()
    if (!isToolPermission(permission))
      throw new AgentRuntimeError(
        'INVALID_RUN_PERMISSION',
        '运行权限无效。',
        400,
      )
    const operation = this.reserve(id, 'run')
    const cleanups: (() => Promise<unknown>)[] = []
    const cleanup = async () => {
      await Promise.allSettled(cleanups.splice(0).map((dispose) => dispose()))
    }
    try {
      const opened = await this.sessions.open(id)
      if (opened.archived) {
        throw new AgentRuntimeError(
          'SESSION_ARCHIVED',
          '已归档的会话需要恢复后才能继续。',
          409,
        )
      }
      operation.controller.signal.throwIfAborted()
      const model = await this.models.resolveModel(
        opened.config.providerId,
        opened.config.modelId,
      )
      const thinkingLevel = input?.thinkingLevel ?? 'off'
      if (!getSupportedThinkingLevels(model).includes(thinkingLevel)) {
        throw new AgentRuntimeError(
          'THINKING_LEVEL_UNSUPPORTED',
          '当前模型不支持所选推理强度。',
          400,
        )
      }
      operation.controller.signal.throwIfAborted()
      const savedSelection = opened.entries
        .filter(
          (entry) =>
            entry.type === 'custom' &&
            entry.customType === SESSION_CUSTOM_TYPE.pluginSelection,
        )
        .at(-1)
      const savedIds =
        savedSelection?.type === 'custom'
          ? (savedSelection.data as { pluginIds?: unknown }).pluginIds
          : undefined
      const pluginIds = input
        ? (input.pluginIds ?? [])
        : Array.isArray(savedIds) &&
            savedIds.every((id) => typeof id === 'string')
          ? (savedIds as string[])
          : []
      const resolved = await this.capabilities?.resolve(opened.metadata.cwd, {
        ...(input ?? { content: '' }),
        pluginIds,
      })
      if (resolved) cleanups.push(resolved.release)
      if (
        input &&
        (input.commandId || input.skillIds?.length) &&
        !this.capabilities
      ) {
        throw new AgentRuntimeError(
          'AGENT_CAPABILITIES_UNAVAILABLE',
          '当前运行时未启用 Skills 或命令。',
          500,
        )
      }
      const hasStructuredInput = Boolean(
        input &&
        (input.attachments?.length ||
          input.commandId ||
          input.skillIds?.length ||
          resolved?.plugins.length ||
          input.pluginIds),
      )
      const structured =
        input && hasStructuredInput
          ? buildStructuredUserPrompt(input)
          : undefined
      const contextItems: AgentMessageContextItem[] = [
        ...(resolved?.plugins ?? []).map((plugin) => ({
          description: plugin.activeRevision.descriptor.description,
          id: plugin.id,
          kind: 'plugin' as const,
          label: plugin.activeRevision.descriptor.name,
          reference: `@${plugin.activeRevision.descriptor.name}`,
          sourceId: plugin.id,
        })),
        ...(resolved?.command
          ? [
              {
                description: resolved.command.description,
                id: resolved.command.id,
                kind: 'command' as const,
                label: resolved.command.name,
                reference: `/${resolved.command.name}`,
                sourceId: resolved.command.id,
              },
            ]
          : []),
        ...(resolved?.skills ?? [])
          .filter((skill) => input?.skillIds?.includes(skill.id))
          .map((skill) => ({
            description: skill.description,
            id: skill.id,
            kind: 'skill' as const,
            label: skill.name,
            reference: `/${skill.name}`,
            sourceId: skill.id,
          })),
      ]
      const incoming: AgentMessage | undefined = input
        ? structured
          ? createCustomMessage(
              SESSION_CUSTOM_TYPE.userInput,
              structured.content,
              true,
              {
                attachments: structured.attachments,
                content: input.content,
                contextItems,
                schemaVersion: 2,
              },
              Date.now(),
            )
          : createUserMessage(input.content)
        : undefined
      let entries = await this.repairInterruptedTools(
        opened.session,
        opened.entries,
        id,
      )
      try {
        entries = await compactSessionIfNeeded({
          entries,
          ...(incoming ? { incoming } : {}),
          model,
          models: this.models.models,
          session: opened.session,
          signal: operation.controller.signal,
        })
      } catch (error) {
        await this.sessions.changed(id)
        throw error
      }
      if (entries !== opened.entries) await this.sessions.changed(id)
      const context = buildSessionContext(entries)
      const currentTodos = incoming
        ? undefined
        : projectRecoverableTodos(entries)
      if (!incoming) {
        const last = context.messages.at(-1)
        if (
          !last ||
          (last.role !== 'user' &&
            last.role !== 'toolResult' &&
            last.role !== 'custom')
        ) {
          throw new AgentRuntimeError(
            'NOTHING_TO_CONTINUE',
            '当前会话没有可继续的用户消息。',
            409,
          )
        }
      }
      operation.controller.signal.throwIfAborted()

      const events = new ActiveRunEventChannel(permission)
      operation.events = events
      const run = events.subscribe()
      const runId = randomUUID()
      const trajectory = new TrajectoryStream((event) => events.push(event))
      operation.trajectory = trajectory
      const publishTrajectory = async (active = true) =>
        trajectory.publish(
          projectAgentTrajectory({
            active,
            entries: await opened.session.findEntriesOnBranch({
              order: 'oldestFirst',
            }),
            model: model.id,
            sessionId: id,
          }),
        )
      trajectory.snapshot = projectAgentTrajectory({
        active: false,
        entries,
        model: model.id,
        sessionId: id,
      })
      const workspaceTools = this.toolOptions
        ? await createWorkspaceTools({
            cwd: opened.metadata.cwd,
            onApprovalRequested: async (approval) => {
              await this.appendApprovalRequested(opened.session, approval)
              events.push(toToolApprovalEvent(approval))
            },
            onApprovalResolved: (resolution) =>
              this.appendApprovalResolved(opened.session, resolution),
            permission,
            policy: this.toolOptions.policy,
            protectedRoots: this.toolOptions.protectedRoots,
            runId,
            sessionId: id,
          })
        : undefined
      if (workspaceTools) cleanups.push(() => workspaceTools.cleanup())
      cleanups.push(async () => this.toolOptions?.policy.clearRun(runId))
      const mcpTools =
        this.toolOptions?.connections && resolved?.plugins.length
          ? await createMcpTools({
              connections: this.toolOptions.connections,
              targets: pluginConnectionTargets(resolved.plugins),
              policy: this.toolOptions.policy,
              permission,
              runId,
              sessionId: id,
              signal: operation.controller.signal,
              onApprovalRequested: async (approval) => {
                await this.appendApprovalRequested(opened.session, approval)
                events.push(toToolApprovalEvent(approval))
              },
              onApprovalResolved: (resolution) =>
                this.appendApprovalResolved(opened.session, resolution),
            })
          : undefined
      if (mcpTools) cleanups.push(mcpTools.cleanup)
      const skillResourceTool = resolved?.catalog.skills.length
        ? createSkillResourceTool(
            resolved.catalog.skills.map((skill) => ({
              id: skill.id,
              rootDirectory: skill.rootDirectory,
              resourceRootDirectory: skill.resourceRootDirectory,
            })),
          )
        : undefined
      const attachmentResources = attachmentResourcesFromEntries(
        entries,
        incoming,
      )
      const attachmentTool = attachmentResources.length
        ? createAttachmentTool(
            attachmentResources,
            model.input.includes('image'),
          )
        : undefined
      const todoTool = createTodoWriteTool(async (todos) => {
        const snapshot = todos.map((todo) => ({ ...todo }))
        await opened.session.appendCustomEntry(
          SESSION_CUSTOM_TYPE.todoUpdated,
          {
            schemaVersion: 1,
            todos: snapshot,
          },
        )
        this.sessions.changed(id)
        events.push({ todos: snapshot, type: 'todo_updated' })
      })
      const tools = [
        ...(mcpTools?.tools ?? []),
        ...(workspaceTools?.tools ?? []),
        ...(skillResourceTool ? [skillResourceTool] : []),
        ...(attachmentTool ? [attachmentTool] : []),
        todoTool,
      ]
      if (tools.length) {
        await opened.session.appendCustomEntry(SESSION_CUSTOM_TYPE.runPolicy, {
          activeToolNames: tools.map((tool) => tool.name),
          permission,
          runId,
        })
      }
      const systemPrompt = buildSystemPrompt({
        permission,
        currentTodos,
        hasWorkspaceTools: Boolean(workspaceTools),
        skills: resolved?.catalog.skills ?? [],
      })
      const contextMessages: AgentMessage[] = []
      const appendContext = (
        source: string,
        content: string,
        snapshot = false,
      ) => {
        if (snapshot) {
          const previous = [...context.messages]
            .reverse()
            .find(
              (message) =>
                message.role === 'custom' &&
                message.customType === SESSION_CUSTOM_TYPE.agentContext &&
                (message.details as { source?: string } | undefined)?.source ===
                  source,
            )
          if (previous?.role === 'custom' && previous.content === content)
            return
        }
        if (content)
          contextMessages.push(
            createCustomMessage(
              SESSION_CUSTOM_TYPE.agentContext,
              content,
              false,
              { source, snapshot },
              Date.now(),
            ),
          )
      }
      appendContext(
        'runtime',
        buildRuntimeContext(opened.metadata.cwd, permission),
        true,
      )
      appendContext(
        'skills-catalog',
        buildAvailableSkillsPrompt(resolved?.catalog.skills ?? []) ||
          'Available skills: none. Earlier skill catalogs no longer apply.',
        true,
      )
      appendContext(
        'plugin-selection',
        buildSelectedPluginsPrompt(
          resolved?.plugins ?? [],
          resolved?.catalog.skills ?? [],
        ),
        true,
      )
      if (resolved?.commandContent)
        appendContext('command', resolved.commandContent)
      for (const skill of resolved?.skills ?? [])
        appendContext(
          `skill:${skill.id}`,
          `<skill id="${escapePromptXml(skill.id)}">\nResources use the prefix ${skill.id}/.\n${skill.content}\n</skill>`,
        )
      appendContext('task-recovery', buildCurrentTodosPrompt(currentTodos))
      if (mcpTools?.diagnostics.length)
        appendContext('plugin-diagnostics', mcpTools.diagnostics.join('\n'))
      const requestState: {
        id?: string
        startedAt?: number
        firstTokenAt?: number
        turn: number
      } = { turn: 0 }
      const previousHeader = entries
        .filter(
          (entry) =>
            entry.type === 'custom' &&
            entry.customType === SESSION_CUSTOM_TYPE.llmRequestHeader,
        )
        .at(-1)
      let headerJson =
        previousHeader?.type === 'custom'
          ? JSON.stringify(previousHeader.data)
          : ''
      const agent = new Agent({
        beforeToolCall: async (call, signal) =>
          call.toolCall.name === BUILTIN_TOOL_NAME.loadSkillResource ||
          call.toolCall.name === BUILTIN_TOOL_NAME.viewAttachment ||
          call.toolCall.name === BUILTIN_TOOL_NAME.todoWrite
            ? undefined
            : mcpTools?.owns(call.toolCall.name)
              ? mcpTools.beforeToolCall(call, signal)
              : workspaceTools?.beforeToolCall(call, signal),
        initialState: {
          messages: context.messages,
          model,
          systemPrompt,
          thinkingLevel,
          tools,
        },
        convertToLlm: convertAttachmentMessagesToLlm,
        sessionId: id,
        streamFn: async (streamModel, streamContext, options) => {
          const header = redactTrajectoryValue({
            config: {
              provider: streamModel.provider,
              model: streamModel.id,
              api: streamModel.api,
              reasoningEffort: thinkingLevel,
              maxTokens: options?.maxTokens,
              temperature: options?.temperature,
            },
            system: streamContext.systemPrompt ?? '',
            tools:
              streamContext.tools?.map(({ name, description, parameters }) => ({
                name,
                description,
                parameters,
              })) ?? [],
          })
          const serialized = JSON.stringify(header)
          if (serialized !== headerJson) {
            await opened.session.appendCustomEntry(
              SESSION_CUSTOM_TYPE.llmRequestHeader,
              JSON.parse(serialized),
            )
            headerJson = serialized
          }
          requestState.startedAt = Date.now()
          requestState.firstTokenAt = undefined
          requestState.id = await opened.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.llmRequestStarted,
            {
              api: streamModel.api,
              modelId: streamModel.id,
              providerId: streamModel.provider,
              runId,
              turn: requestState.turn,
              schemaVersion: 1,
              startedAt: requestState.startedAt,
            },
          )
          await publishTrajectory()
          return this.models.models.streamSimple(
            streamModel,
            streamContext,
            options,
          )
        },
        toolExecution: 'sequential',
      })
      operation.agent = agent
      await opened.session.appendCustomEntry(
        SESSION_CUSTOM_TYPE.pluginSelection,
        {
          pluginIds: resolved?.plugins.map((plugin) => plugin.id) ?? [],
          schemaVersion: 1,
        },
      )
      await opened.session.appendCustomEntry(SESSION_CUSTOM_TYPE.runStarted, {
        runId,
        startedAt: Date.now(),
        reason: incoming ? 'prompt' : 'continue',
      })
      void this.executeRun({
        agent,
        cleanupTools: cleanup,
        events,
        ...(incoming ? { incoming } : {}),
        operation,
        runId,
        requestState,
        publishTrajectory,
        trajectory,
        contextMessages,
        session: opened.session,
        sessionId: id,
      }).finally(() => this.release(id, operation))
      return run
    } catch (error) {
      await cleanup()
      this.release(id, operation)
      if (error instanceof PluginError)
        throw new AgentRuntimeError('AGENT_SKILL_NOT_FOUND', error.message, 400)
      if (
        error instanceof AgentRuntimeError ||
        error instanceof ModelServiceError
      ) {
        throw error
      }
      if (operation.controller.signal.aborted) {
        throw new AgentRuntimeError('AGENT_RUN_ABORTED', '运行已终止。', 409)
      }
      throw new AgentRuntimeError(
        'AGENT_RUN_SETUP_FAILED',
        'Agent 运行初始化失败。',
        500,
      )
    }
  }

  private async executeRun(options: {
    agent: Agent
    cleanupTools?: () => Promise<void>
    events: ActiveRunEventChannel
    incoming?: AgentMessage
    operation: ActiveOperation
    runId: string
    requestState: {
      id?: string
      startedAt?: number
      firstTokenAt?: number
      turn: number
    }
    publishTrajectory: (active?: boolean) => Promise<void>
    trajectory: TrajectoryStream
    contextMessages: AgentMessage[]
    session: Awaited<ReturnType<AgentSessionService['open']>>['session']
    sessionId: string
  }) {
    let finalEntryId: string | undefined
    let finalMessage: AssistantMessage | undefined
    let persistenceError: unknown
    let runStatus = 'failed'
    let terminal: Extract<AgentRuntimeEvent, { type: 'done' | 'error' }> = {
      type: 'error',
      code: 'AGENT_RUN_FAILED',
      message: '运行失败。',
    }

    const changed = options.publishTrajectory
    const completeRequest = async (message: AssistantMessage) => {
      if (!options.requestState.id) return
      await options.session.appendCustomEntry(
        SESSION_CUSTOM_TYPE.llmRequestCompleted,
        {
          completedAt: Date.now(),
          requestEntryId: options.requestState.id,
          ...(options.requestState.firstTokenAt === undefined
            ? {}
            : { firstTokenAt: options.requestState.firstTokenAt }),
          ...(message.responseId ? { responseId: message.responseId } : {}),
          schemaVersion: 1,
          status:
            message.stopReason === 'error'
              ? 'failed'
              : message.stopReason === 'aborted'
                ? 'aborted'
                : 'completed',
          stopReason: message.stopReason,
          usage: {
            cacheRead: message.usage.cacheRead,
            cacheWrite: message.usage.cacheWrite,
            input: message.usage.input,
            output: message.usage.output,
            total: message.usage.totalTokens,
          },
        },
      )
      options.requestState.id = undefined
      await changed()
    }

    options.agent.subscribe(async (event) => {
      if (persistenceError) throw persistenceError
      try {
        if (event.type === 'turn_start') {
          options.requestState.turn += 1
          await options.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.turnStarted,
            {
              runId: options.runId,
              turn: options.requestState.turn,
              startedAt: Date.now(),
            },
          )
          await changed()
          return
        }
        if (event.type === 'turn_end') {
          await options.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.turnCompleted,
            {
              runId: options.runId,
              turn: options.requestState.turn,
              completedAt: Date.now(),
            },
          )
          await changed()
          return
        }
        if (
          event.type === 'message_update' &&
          options.requestState.firstTokenAt === undefined &&
          (event.assistantMessageEvent.type === 'text_delta' ||
            event.assistantMessageEvent.type === 'thinking_delta' ||
            event.assistantMessageEvent.type === 'toolcall_delta')
        ) {
          options.requestState.firstTokenAt = Date.now()
        }
        if (event.type === 'message_update' && options.requestState.id) {
          const update = event.assistantMessageEvent
          if (
            update.type === 'text_delta' ||
            update.type === 'thinking_delta'
          ) {
            options.trajectory.delta(
              options.requestState.id,
              update.delta,
              update.type === 'text_delta' ? 'text' : 'thinking',
            )
          }
        }
        if (event.type === 'tool_execution_start') {
          await options.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.toolExecutionStarted,
            {
              schemaVersion: 1,
              startedAt: Date.now(),
              toolCallId: event.toolCallId,
              toolName: event.toolName,
            },
          )
          await changed()
          return
        }
        if (event.type === 'tool_execution_end') {
          await options.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.toolExecutionCompleted,
            {
              completedAt: Date.now(),
              isError: event.isError,
              schemaVersion: 1,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
            },
          )
          await changed()
          return
        }
        if (event.type !== 'message_end') return
        const durableMessage = toDurableMessage(
          event.message,
          options.operation.controller.signal.aborted,
        )
        const entryId = await options.session.appendMessage(durableMessage)
        if (
          durableMessage.role === 'user' ||
          (durableMessage.role === 'custom' &&
            durableMessage.customType === SESSION_CUSTOM_TYPE.userInput)
        ) {
          await changed()
        } else if (
          durableMessage.role === 'toolResult' ||
          durableMessage.role === 'custom'
        ) {
          await changed()
        }
        if (durableMessage.role === 'assistant') {
          finalEntryId = entryId
          finalMessage = durableMessage
          await completeRequest(durableMessage)
        }
      } catch (error) {
        persistenceError = error
        throw error
      }
    })
    options.agent.subscribe((event) => this.forwardDelta(event, options.events))

    options.events.push({
      permission: options.events.permission,
      sessionId: options.sessionId,
      type: 'start',
    })
    try {
      if (options.incoming)
        await options.agent.prompt([
          options.incoming,
          ...options.contextMessages,
        ])
      else {
        for (const message of options.contextMessages) {
          await options.session.appendMessage(message)
          options.agent.state.messages = [
            ...options.agent.state.messages,
            message,
          ]
        }
        await options.agent.continue()
      }

      if (!finalMessage || !finalEntryId) {
        throw new AgentRuntimeError(
          'AGENT_RUN_FAILED',
          'Agent 未产生可持久化的最终消息。',
          500,
        )
      }
      if (finalMessage.stopReason === 'aborted') {
        runStatus = 'aborted'
        terminal = {
          code: 'AGENT_RUN_ABORTED',
          message: '运行已终止。',
          type: 'error',
        }
        return
      }
      if (finalMessage.stopReason === 'error') {
        terminal = {
          code: 'AGENT_RUN_FAILED',
          message: '模型调用失败。',
          type: 'error',
        }
        return
      }
      if (finalMessage.stopReason === 'pending') {
        throw new AgentRuntimeError(
          'AGENT_RUN_FAILED',
          'Agent 返回了未完成的消息。',
          500,
        )
      }
      const usage = finalMessage.usage
      runStatus = 'completed'
      let contextUsage
      try {
        contextUsage = calculateContextUsage(options.agent.state)
        await options.session.appendCustomEntry(
          SESSION_CUSTOM_TYPE.contextUsageSnapshot,
          persistedContextUsageSnapshot(contextUsage),
        )
      } catch {
        contextUsage = undefined
      }
      options.events.push({
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        ...(contextUsage ? { contextUsage } : {}),
        input: usage.input,
        output: usage.output,
        total: usage.totalTokens,
        type: 'usage',
      })
      terminal = {
        entryId: finalEntryId,
        stopReason: finalMessage.stopReason,
        type: 'done',
      }
    } catch (error) {
      terminal = runtimeEventError(
        persistenceError
          ? new AgentRuntimeError(
              'SESSION_PERSISTENCE_FAILED',
              '会话持久化操作失败。',
              500,
            )
          : error,
      )
    } finally {
      try {
        if (!persistenceError) {
          await options.session.appendCustomEntry(
            SESSION_CUSTOM_TYPE.runCompleted,
            {
              runId: options.runId,
              completedAt: Date.now(),
              status: options.operation.controller.signal.aborted
                ? 'aborted'
                : runStatus,
            },
          )
        }
        await this.sessions.changed(options.sessionId)
        await changed(false)
      } catch {
        terminal = {
          type: 'error',
          code: 'SESSION_PERSISTENCE_FAILED',
          message: '会话持久化操作失败。',
        }
      } finally {
        try {
          await options.cleanupTools?.()
        } catch {
          terminal = {
            type: 'error',
            code: 'AGENT_RUN_CLEANUP_FAILED',
            message: '运行资源清理失败。',
          }
        }
        options.events.push(terminal)
        options.events.end()
      }
    }
  }

  private forwardDelta(event: AgentEvent, events: ActiveRunEventChannel) {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') {
        events.push({ delta: update.delta, type: 'text_delta' })
      } else if (update.type === 'thinking_delta') {
        events.push({ delta: update.delta, type: 'reasoning_delta' })
      }
    } else if (event.type === 'tool_execution_start') {
      events.push({
        input: safeToolInput(event.args),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        kind: getToolActivityKind(event.toolName),
        type: 'tool_start',
      })
    } else if (event.type === 'tool_execution_end') {
      const outcome =
        event.toolName === BUILTIN_TOOL_NAME.bash
          ? safeBashOutcome(event.result?.details)
          : undefined
      events.push({
        isError: event.isError,
        ...(toolFilePath(event.result?.details)
          ? { filePath: toolFilePath(event.result?.details) }
          : {}),
        ...(outcome ? { outcome } : {}),
        output: event.result?.content,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        kind: getToolActivityKind(event.toolName),
        type: 'tool_end',
      })
    }
  }

  private async appendApprovalRequested(
    session: Awaited<ReturnType<AgentSessionService['open']>>['session'],
    approval: PendingToolApproval,
  ) {
    await session.appendCustomEntry(SESSION_CUSTOM_TYPE.approvalRequested, {
      approvalId: approval.approvalId,
      effect: approval.effect,
      ...('scope' in approval ? { scope: approval.scope } : {}),
      runId: approval.runId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
    })
  }

  private async appendApprovalResolved(
    session: Awaited<ReturnType<AgentSessionService['open']>>['session'],
    resolution: ApprovalResolution,
  ) {
    await session.appendCustomEntry(SESSION_CUSTOM_TYPE.approvalResolved, {
      approvalId: resolution.approvalId,
      decision: resolution.decision,
      reason: resolution.reason,
      runId: resolution.runId,
      toolCallId: resolution.toolCallId,
    })
  }

  private async repairInterruptedTools(
    session: Awaited<ReturnType<AgentSessionService['open']>>['session'],
    entries: Awaited<ReturnType<AgentSessionService['open']>>['entries'],
    sessionId: string,
  ) {
    const completedToolCalls = new Set(
      entries.flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'toolResult'
          ? [entry.message.toolCallId]
          : [],
      ),
    )
    const resolvedApprovals = new Set(
      entries.flatMap((entry) => {
        if (
          entry.type !== 'custom' ||
          entry.customType !== SESSION_CUSTOM_TYPE.approvalResolved ||
          !entry.data ||
          typeof entry.data !== 'object' ||
          Array.isArray(entry.data)
        ) {
          return []
        }
        const approvalId = (entry.data as Record<string, unknown>).approvalId
        return typeof approvalId === 'string' ? [approvalId] : []
      }),
    )
    const approvalByToolCall = new Map<string, string>()
    for (const entry of entries) {
      if (
        entry.type !== 'custom' ||
        entry.customType !== SESSION_CUSTOM_TYPE.approvalRequested ||
        !entry.data ||
        typeof entry.data !== 'object' ||
        Array.isArray(entry.data)
      ) {
        continue
      }
      const data = entry.data as Record<string, unknown>
      if (
        typeof data.approvalId === 'string' &&
        typeof data.toolCallId === 'string'
      ) {
        approvalByToolCall.set(data.toolCallId, data.approvalId)
      }
    }
    const interrupted: { id: string; name: string }[] = []
    for (const entry of entries) {
      if (entry.type !== 'message' || entry.message.role !== 'assistant') {
        continue
      }
      for (const content of entry.message.content) {
        if (
          content.type === 'toolCall' &&
          !completedToolCalls.has(content.id)
        ) {
          interrupted.push({ id: content.id, name: content.name })
        }
      }
    }
    if (!interrupted.length) return entries

    for (const toolCall of interrupted) {
      const approvalId = approvalByToolCall.get(toolCall.id)
      if (approvalId && !resolvedApprovals.has(approvalId)) {
        await session.appendCustomEntry(SESSION_CUSTOM_TYPE.approvalResolved, {
          approvalId,
          decision: 'reject',
          reason: 'server-restarted',
          toolCallId: toolCall.id,
        })
      }
      await session.appendMessage({
        content: [
          {
            text: 'Tool execution was interrupted by a server restart and was not retried.',
            type: 'text',
          },
        ],
        isError: true,
        role: 'toolResult',
        timestamp: Date.now(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      })
    }
    await this.sessions.changed(sessionId)
    return session.findEntriesOnBranch({ order: 'oldestFirst' })
  }

  private reserve(id: string, kind: ActiveOperation['kind']) {
    if (this.active.has(id)) {
      throw new AgentRuntimeError('SESSION_BUSY', '会话正在执行其他操作。', 409)
    }
    let finish: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      finish = resolve
    })
    const operation: ActiveOperation = {
      controller: new AbortController(),
      finish,
      kind,
      settled,
    }
    this.active.set(id, operation)
    return operation
  }

  private release(id: string, operation: ActiveOperation) {
    if (this.active.get(id) === operation) this.active.delete(id)
    operation.finish()
  }

  private async deleteSessionsWhere(
    predicate: (session: AgentSessionInfo) => boolean,
  ) {
    const sessions = (await this.sessions.listFromSource()).filter(predicate)
    const operations = new Map<string, ActiveOperation>()
    try {
      for (const session of sessions) {
        operations.set(session.id, this.reserve(session.id, 'mutation'))
      }
      for (const session of sessions) await this.sessions.delete(session.id)
      return sessions.length
    } finally {
      for (const [id, operation] of operations) this.release(id, operation)
    }
  }

  private assertOpen() {
    if (this.closed) {
      throw new AgentRuntimeError(
        'AGENT_RUNTIME_CLOSED',
        'Agent Runtime 已关闭。',
        500,
      )
    }
  }
}
