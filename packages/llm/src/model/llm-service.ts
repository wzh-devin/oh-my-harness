import type {
  AssistantMessage,
  Context,
  Models,
  Usage,
} from '@earendil-works/pi-ai'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import {
  AUTH_METHOD,
  MESSAGE_ROLE,
  MODEL_THINKING_LEVEL,
  PROVIDER_AUTH_STATUS,
  PROVIDER_CONFIG_STATUS,
} from '@oh-my-harness/shared'

import type { FileProviderConfigStore } from '../provider/provider-config-store.ts'
import type {
  ProviderConfig,
  ProviderInfo,
  ProviderModelInfo,
} from '../provider/provider-types.ts'
import type { CompletionMessage, CompletionRequest } from './model-types.ts'

const emptyUsage: Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
}

function toMessage(
  message: CompletionMessage,
  request: CompletionRequest,
  api: string,
) {
  if (message.role === MESSAGE_ROLE.USER) {
    return {
      content: message.content,
      role: MESSAGE_ROLE.USER,
      timestamp: Date.now(),
    }
  }
  return {
    api,
    content: [{ text: message.content, type: 'text' as const }],
    model: request.modelId,
    provider: request.providerId,
    role: MESSAGE_ROLE.ASSISTANT,
    stopReason: 'stop' as const,
    timestamp: Date.now(),
    usage: emptyUsage,
  } satisfies AssistantMessage
}

/** 可在启动 SSE 前映射为稳定 HTTP 错误的模型配置异常。 */
export class ModelServiceError extends Error {
  readonly code: string
  readonly status: 400 | 404 | 409

  constructor(code: string, message: string, status: 400 | 404 | 409) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** 对外提供 Provider 元数据和单次模型流。 */
export class ModelService {
  readonly models: Models
  private readonly configurations: FileProviderConfigStore

  constructor(models: Models, configurations: FileProviderConfigStore) {
    this.models = models
    this.configurations = configurations
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const configurations = await this.configurations.list()
    return Promise.all(
      this.models.getProviders().map(async (provider) => {
        const auth = await this.models
          .checkAuth(provider.id)
          .catch(() => undefined)
        const selectedModels = configurations[provider.id]?.models ?? []
        return {
          authStatus: auth
            ? PROVIDER_AUTH_STATUS.AUTHORIZED
            : PROVIDER_AUTH_STATUS.UNAUTHORIZED,
          authMethods: [
            ...(provider.auth.apiKey ? [AUTH_METHOD.API_KEY] : []),
            ...(provider.auth.oauth ? [AUTH_METHOD.OAUTH] : []),
          ],
          configStatus: selectedModels.length
            ? PROVIDER_CONFIG_STATUS.CONFIGURED
            : PROVIDER_CONFIG_STATUS.UNCONFIGURED,
          configuredAuthMethod: auth?.type,
          displayName: provider.name,
          models: selectedModels.map((selectedModel) => {
            const model = this.models.getModel(provider.id, selectedModel.id)
            return {
              ...selectedModel,
              thinkingLevels: model
                ? getSupportedThinkingLevels(model)
                : [MODEL_THINKING_LEVEL.OFF],
            }
          }),
          providerId: provider.id,
          ready: !!auth && selectedModels.length > 0,
        }
      }),
    )
  }

  async getProviderInfo(providerId: string) {
    return (await this.listProviders()).find(
      (provider) => provider.providerId === providerId,
    )
  }

  /** 从 Pi AI Provider 读取完整模型目录，供未认证的新增流程使用。 */
  getProviderModels(providerId: string): ProviderModelInfo[] | undefined {
    if (!this.models.getProvider(providerId)) return undefined
    return this.models.getModels(providerId).map((model) => ({
      id: model.id,
      name: model.id,
      thinkingLevels: getSupportedThinkingLevels(model),
    }))
  }

  /** 解析已启用且已认证的模型，供 Agent Runtime 安全复用。 */
  async resolveModel(providerId: string, modelId: string) {
    if (!this.models.getProvider(providerId)) {
      throw new ModelServiceError(
        'PROVIDER_NOT_FOUND',
        'Provider 不存在。',
        404,
      )
    }
    const selectedModels = await this.configurations.read(providerId)
    if (!selectedModels.some((model) => model.id === modelId)) {
      throw new ModelServiceError(
        'MODEL_NOT_ENABLED',
        '模型尚未在该提供方中启用。',
        400,
      )
    }
    const auth = await this.models.checkAuth(providerId).catch(() => undefined)
    if (!auth) {
      throw new ModelServiceError(
        'PROVIDER_NOT_READY',
        'Provider 尚未授权或凭证已失效。',
        409,
      )
    }
    const model = this.models.getModel(providerId, modelId)
    if (!model) {
      throw new ModelServiceError('MODEL_NOT_FOUND', '模型不存在。', 404)
    }
    return model
  }

  /** 校验并原子替换用户显式启用的模型列表。 */
  async saveProviderConfig(providerId: string, configuration: ProviderConfig) {
    if (!this.models.getProvider(providerId)) {
      throw new ModelServiceError(
        'PROVIDER_NOT_FOUND',
        'Provider 不存在。',
        404,
      )
    }

    const catalogIds = new Set(
      this.models.getModels(providerId).map((model) => model.id),
    )
    const modelIds = new Set<string>()
    const models = configuration.models.map((model) => {
      const id = model.id.trim()
      if (!id || modelIds.has(id)) {
        throw new ModelServiceError(
          'INVALID_PROVIDER_CONFIG',
          id ? `模型 ID 重复：${id}` : '模型 ID 不能为空。',
          400,
        )
      }
      if (!catalogIds.has(id)) {
        throw new ModelServiceError(
          'MODEL_NOT_FOUND',
          `Pi AI 当前目录中不存在模型：${id}`,
          400,
        )
      }
      modelIds.add(id)
      return { id, name: model.name?.trim() || id }
    })

    await this.configurations.replace(providerId, models)
  }

  async deleteProvider(providerId: string) {
    if (!this.models.getProvider(providerId)) {
      throw new ModelServiceError(
        'PROVIDER_NOT_FOUND',
        'Provider 不存在。',
        404,
      )
    }
    await this.models.logout(providerId)
    await this.configurations.delete(providerId)
  }

  async saveApiKey(providerId: string, apiKey: string) {
    const provider = this.models.getProvider(providerId)
    if (!provider?.auth.apiKey) throw new Error('Provider 不支持 API Key。')
    await this.models.login(providerId, AUTH_METHOD.API_KEY, {
      notify() {},
      async prompt() {
        return apiKey
      },
    })
  }

  async deleteCredential(providerId: string) {
    if (!this.models.getProvider(providerId))
      throw new Error('Provider 不存在。')
    await this.models.logout(providerId)
  }

  async stream(request: CompletionRequest, signal: AbortSignal) {
    const model = await this.resolveModel(request.providerId, request.modelId)
    const context: Context = {
      messages: request.messages.map((message) =>
        toMessage(message, request, model.api),
      ),
      systemPrompt: request.systemPrompt,
    }
    return this.models.streamSimple(model, context, {
      signal,
      toolChoice: 'none',
    })
  }
}
