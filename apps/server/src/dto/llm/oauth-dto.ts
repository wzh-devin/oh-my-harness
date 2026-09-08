import type { OAuthPromptType, OAuthSessionState } from '@oh-my-harness/shared'

export interface OAuthSessionCreateRequestDto {
  authMode?: string
  providerId: string
}

export interface OAuthPromptDto {
  message: string
  options?: Array<{ label: string; value: string }>
  promptId: string
  promptType: OAuthPromptType
}

export interface OAuthSessionStatusResponseDto {
  authorizationUrl?: string
  deviceCode?: { userCode: string; verificationUri: string }
  error?: { code: string; message: string }
  expiresAt: string
  progress?: string
  prompt?: OAuthPromptDto
  sessionId: string
  status: OAuthSessionState
}

export interface OAuthSessionInputRequestDto {
  promptId: string
  value: string
}
