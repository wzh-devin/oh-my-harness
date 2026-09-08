export const CHAT_ROUTE_KIND = {
  EXPLORE: 'explore',
  LIBRARY: 'library',
  NEW: 'new',
  THREAD: 'thread',
} as const
export type ChatRouteKind =
  (typeof CHAT_ROUTE_KIND)[keyof typeof CHAT_ROUTE_KIND]

export const CHAT_ASSISTANT_STATUS = {
  COMPLETE: 'complete',
  SKELETON: 'skeleton',
  STREAMING: 'streaming',
} as const
export type ChatAssistantStatus =
  (typeof CHAT_ASSISTANT_STATUS)[keyof typeof CHAT_ASSISTANT_STATUS]

export const COMPOSER_MENU_MODE = {
  MENTION: 'mention',
  PLUS: 'plus',
  SLASH: 'slash',
} as const
export type ComposerMenuMode =
  (typeof COMPOSER_MENU_MODE)[keyof typeof COMPOSER_MENU_MODE]

export const COMPOSER_CAPABILITY_KIND = {
  ATTACHMENT: 'attachment',
  COMMAND: 'command',
  MCP: 'mcp',
  PLUGIN: 'plugin',
  SKILL: 'skill',
} as const
export type ComposerCapabilityKind =
  (typeof COMPOSER_CAPABILITY_KIND)[keyof typeof COMPOSER_CAPABILITY_KIND]

export const CHAT_TOOL_KIND = {
  BROWSER: 'browser',
  COMMAND: 'command',
  EDIT: 'edit',
  READ: 'read',
  SEARCH: 'search',
  SKILL: 'skill',
  TOOL: 'tool',
} as const
export type ChatToolKind = (typeof CHAT_TOOL_KIND)[keyof typeof CHAT_TOOL_KIND]

export const CHAT_MESSAGE_SOURCE_TYPE = {
  URL: 'url',
  DOCUMENT: 'document',
} as const

export const PLAN_STEP_STATE = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const
export type PlanStepState =
  (typeof PLAN_STEP_STATE)[keyof typeof PLAN_STEP_STATE]

export const PLUGIN_SETTINGS_TAB = {
  MARKETPLACES: 'marketplaces',
  PLUGINS: 'plugins',
  SKILLS: 'skills',
} as const
export type PluginSettingsTab =
  (typeof PLUGIN_SETTINGS_TAB)[keyof typeof PLUGIN_SETTINGS_TAB]

export const SETTINGS_SECTION = {
  ARCHIVED: 'archived',
  GENERAL: 'general',
  MODELS: 'models',
  PLUGINS: 'plugins',
} as const
export type SettingsSection =
  (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION]
