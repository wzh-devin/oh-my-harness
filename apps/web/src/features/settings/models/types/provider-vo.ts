import type {
  AuthMethod,
  ModelThinkingLevel as SharedModelThinkingLevel,
  OAuthPromptType,
  OAuthSessionState,
  ProviderAuthStatus,
  ProviderConfigStatus,
} from '@oh-my-harness/shared'

export type AuthMethodVo = AuthMethod

export type ProviderAuthStatusVo = ProviderAuthStatus

export type ProviderConfigStatusVo = ProviderConfigStatus

export interface ProviderModelInfoVo {
  id: string
  name: string
  thinkingLevels?: ModelThinkingLevel[]
}

export type ModelThinkingLevel = SharedModelThinkingLevel

export interface ProviderInfoVo {
  authStatus: ProviderAuthStatusVo
  authMethods: AuthMethodVo[]
  configStatus: ProviderConfigStatusVo
  configuredAuthMethod?: AuthMethodVo
  displayName: string
  models: ProviderModelInfoVo[]
  providerId: string
  ready: boolean
}

export interface OAuthPromptVo {
  message: string
  options?: Array<{ label: string; value: string }>
  promptId: string
  promptType: OAuthPromptType
}

export interface OAuthSessionStatusVo {
  authorizationUrl?: string
  deviceCode?: { userCode: string; verificationUri: string }
  error?: { code: string; message: string }
  expiresAt: string
  progress?: string
  prompt?: OAuthPromptVo
  sessionId: string
  status: OAuthSessionState
}
