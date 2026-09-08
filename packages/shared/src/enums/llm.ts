export const MESSAGE_ROLE = {
  ASSISTANT: 'assistant',
  USER: 'user',
} as const
export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE]

export const AUTH_METHOD = {
  API_KEY: 'api_key',
  OAUTH: 'oauth',
} as const
export type AuthMethod = (typeof AUTH_METHOD)[keyof typeof AUTH_METHOD]

export const PROVIDER_AUTH_STATUS = {
  UNAUTHORIZED: 'unauthorized',
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const
export type ProviderAuthStatus =
  (typeof PROVIDER_AUTH_STATUS)[keyof typeof PROVIDER_AUTH_STATUS]

export const PROVIDER_CONFIG_STATUS = {
  UNCONFIGURED: 'unconfigured',
  CONFIGURED: 'configured',
} as const
export type ProviderConfigStatus =
  (typeof PROVIDER_CONFIG_STATUS)[keyof typeof PROVIDER_CONFIG_STATUS]

export const MODEL_THINKING_LEVEL = {
  OFF: 'off',
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  XHIGH: 'xhigh',
  MAX: 'max',
} as const
export type ModelThinkingLevel =
  (typeof MODEL_THINKING_LEVEL)[keyof typeof MODEL_THINKING_LEVEL]

export const API_PROTOCOL = {
  OPENAI_COMPLETIONS: 'openai-completions',
  OPENAI_RESPONSES: 'openai-responses',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
} as const
export type ApiProtocol = (typeof API_PROTOCOL)[keyof typeof API_PROTOCOL]

export const OAUTH_PROMPT_TYPE = {
  TEXT: 'text',
  SECRET: 'secret',
  SELECT: 'select',
  MANUAL_CODE: 'manual_code',
} as const
export type OAuthPromptType =
  (typeof OAUTH_PROMPT_TYPE)[keyof typeof OAUTH_PROMPT_TYPE]

export const OAUTH_SESSION_STATUS = {
  AWAITING_USER: 'awaiting_user',
  AWAITING_PROVIDER: 'awaiting_provider',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const
export type OAuthSessionState =
  (typeof OAUTH_SESSION_STATUS)[keyof typeof OAUTH_SESSION_STATUS]

export const COMPLETION_EVENT_TYPE = {
  START: 'start',
  TEXT_DELTA: 'text_delta',
  REASONING_DELTA: 'reasoning_delta',
  USAGE: 'usage',
  DONE: 'done',
  ERROR: 'error',
} as const
export type CompletionEventType =
  (typeof COMPLETION_EVENT_TYPE)[keyof typeof COMPLETION_EVENT_TYPE]
