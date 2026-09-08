import type {
  AuthMethod,
  ModelThinkingLevel,
  ProviderAuthStatus,
  ProviderConfigStatus,
} from '@oh-my-harness/shared'

export type {
  AuthMethod,
  ModelThinkingLevel,
  ProviderAuthStatus,
  ProviderConfigStatus,
} from '@oh-my-harness/shared'

export interface ProviderModelInfo {
  id: string
  name: string
  thinkingLevels?: ModelThinkingLevel[]
}

export interface ProviderInfo {
  authStatus: ProviderAuthStatus
  authMethods: AuthMethod[]
  configStatus: ProviderConfigStatus
  configuredAuthMethod?: AuthMethod
  displayName: string
  models: ProviderModelInfo[]
  providerId: string
  ready: boolean
}

export interface ProviderConfig {
  models: Array<{ id: string; name?: string }>
}
