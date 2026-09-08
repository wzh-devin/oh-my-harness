import type {
  AuthMethod,
  ModelThinkingLevel,
  ProviderAuthStatus,
  ProviderConfigStatus,
} from '@oh-my-harness/shared'

export type AuthMethodDto = AuthMethod

export type ProviderAuthStatusDto = ProviderAuthStatus

export type ProviderConfigStatusDto = ProviderConfigStatus

export interface ApiKeyCredentialRequestDto {
  apiKey: string
}

export interface ProviderModelInfoDto {
  id: string
  name: string
  thinkingLevels?: ModelThinkingLevelDto[]
}

export type ModelThinkingLevelDto = ModelThinkingLevel

export interface ProviderInfoDto {
  authStatus: ProviderAuthStatusDto
  authMethods: AuthMethodDto[]
  configStatus: ProviderConfigStatusDto
  configuredAuthMethod?: AuthMethodDto
  displayName: string
  models: ProviderModelInfoDto[]
  providerId: string
  ready: boolean
}

export interface ProviderConfigUpdateDto {
  models: Array<{ id: string; name?: string }>
}
