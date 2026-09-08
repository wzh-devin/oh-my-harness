import type {
  AuthMethodVo,
  ModelThinkingLevel,
  ProviderAuthStatusVo,
  ProviderConfigStatusVo,
  ProviderInfoVo,
} from '../types/provider-vo.ts'
import {
  API_PROTOCOL,
  MODEL_THINKING_LEVEL,
  type ApiProtocol,
} from '@oh-my-harness/shared'

export type { ModelThinkingLevel } from '../types/provider-vo.ts'
export type { ApiProtocol } from '@oh-my-harness/shared'

export interface ProviderModelConfig {
  id: string
  name: string
  thinkingLevels?: ModelThinkingLevel[]
}

export interface OAuthLoginOption {
  id: string
  label: string
}

export const API_PROTOCOL_OPTIONS = [
  { id: API_PROTOCOL.OPENAI_COMPLETIONS, label: 'openai-completions' },
  { id: API_PROTOCOL.OPENAI_RESPONSES, label: 'openai-responses' },
  { id: API_PROTOCOL.ANTHROPIC_MESSAGES, label: 'anthropic-messages' },
] as const

export interface ProviderConfiguration {
  apiProtocol?: ApiProtocol
  baseUrl: string
  models: ProviderModelConfig[]
}

export interface ModelProvider extends ProviderConfiguration {
  authStatus: ProviderAuthStatusVo
  authMethods: AuthMethodVo[]
  configStatus: ProviderConfigStatusVo
  configuredAuthMethod?: AuthMethodVo
  id: string
  isCustom: boolean
  name: string
  ready: boolean
}

export interface SelectableModel {
  id: string
  key: string
  name: string
  thinkingLevels: ModelThinkingLevel[]
}

export interface SelectableModelGroup {
  id: string
  models: SelectableModel[]
  name: string
}

const OAUTH_LOGIN_OPTIONS: Record<string, readonly OAuthLoginOption[]> = {
  'openai-codex': [
    { id: 'browser', label: '浏览器登录（推荐）' },
    { id: 'device_code', label: '设备码登录' },
  ],
}

/** 返回需要在授权前由用户选择的 OAuth 登录方式。 */
export function getOAuthLoginOptions(providerId: string): OAuthLoginOption[] {
  return OAUTH_LOGIN_OPTIONS[providerId]?.map((option) => ({ ...option })) ?? []
}

/** 创建供设置页和聊天模型菜单共用的页面会话初始配置。 */
export const createInitialModelProviders = (): ModelProvider[] => []

/** 将 Server 契约转换成设置页与聊天菜单共用的数据结构。 */
export const toModelProvider = (provider: ProviderInfoVo): ModelProvider => ({
  authStatus: provider.authStatus,
  authMethods: provider.authMethods,
  baseUrl: '',
  configStatus: provider.configStatus,
  configuredAuthMethod: provider.configuredAuthMethod,
  id: provider.providerId,
  isCustom: false,
  models: provider.models,
  name: provider.displayName,
  ready: provider.ready,
})

/** 将已配置提供方转换成可供二级菜单展示的去重模型分组。 */
export const getSelectableModelGroups = (
  providers: readonly ModelProvider[],
): SelectableModelGroup[] => {
  const knownKeys = new Set<string>()

  return providers.flatMap((provider) => {
    if (!provider.ready) return []

    const models = provider.models.flatMap((model) => {
      const id = model.id.trim()
      const key = `${provider.id}:${id}`
      if (!id || knownKeys.has(key)) return []

      knownKeys.add(key)
      return [
        {
          id,
          key,
          name: model.name.trim() || id,
          thinkingLevels: [
            ...(model.thinkingLevels ?? [MODEL_THINKING_LEVEL.OFF]),
          ],
        },
      ]
    })

    return models.length
      ? [{ id: provider.id, models, name: provider.name }]
      : []
  })
}

/** 保留模型支持的推理等级，不支持时安全回退为关闭。 */
export const resolveModelThinkingLevel = (
  levels: readonly ModelThinkingLevel[],
  current: ModelThinkingLevel,
) => (levels.includes(current) ? current : MODEL_THINKING_LEVEL.OFF)

/** 保留有效选择，否则按初始模型 ID 或首个可用模型回退。 */
export const resolveModelSelectionKey = (
  groups: readonly SelectableModelGroup[],
  currentKey: string,
  initialModelId: string,
) => {
  const models = groups.flatMap((group) => group.models)
  const currentModel = models.find((model) => model.key === currentKey)
  if (currentModel) return currentModel.key

  return currentKey
    ? (models[0]?.key ?? '')
    : (models.find((model) => model.id === initialModelId)?.key ??
        models[0]?.key ??
        '')
}

export function mergeProviderModels(
  current: ProviderModelConfig[],
  incoming: ProviderModelConfig[],
): ProviderModelConfig[] {
  const knownIds = new Set(current.map((model) => model.id))
  const merged = [...current]
  for (const model of incoming) {
    if (knownIds.has(model.id)) continue
    knownIds.add(model.id)
    merged.push(model)
  }
  return merged
}
