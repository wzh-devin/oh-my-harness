import type { OAuthPromptType, OAuthSessionState } from '@oh-my-harness/shared'

export interface OAuthPrompt {
  message: string
  options?: Array<{ label: string; value: string }>
  promptId: string
  promptType: OAuthPromptType
}

export interface OAuthSessionStatus {
  authorizationUrl?: string
  deviceCode?: { userCode: string; verificationUri: string }
  error?: { code: string; message: string }
  expiresAt: string
  progress?: string
  prompt?: OAuthPrompt
  sessionId: string
  status: OAuthSessionState
}
