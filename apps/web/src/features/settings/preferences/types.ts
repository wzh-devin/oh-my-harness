import type {
  AppearanceMode,
  ModelThinkingLevel,
  ToolPermission,
} from '@oh-my-harness/shared'

export interface PreferencesVo {
  appearance: AppearanceMode
  budget: { dailyUsd: number | null; sessionUsd: number | null }
  defaultModel: { modelId: string; providerId: string }
  defaultPermission: ToolPermission
  defaultThinkingLevel: ModelThinkingLevel
  diagnostic?: { code: string; message: string }
  language: string
  retry: { enabled: boolean; maxRetries: number; maxRetryDelayMs: number }
  schemaVersion: 1
}

export const defaultPreferences = (): PreferencesVo => ({
  appearance: 'system',
  budget: { dailyUsd: null, sessionUsd: null },
  defaultModel: { modelId: '', providerId: '' },
  defaultPermission: 'workspace-write',
  defaultThinkingLevel: 'off',
  language: 'zh-CN',
  retry: { enabled: true, maxRetries: 1, maxRetryDelayMs: 30_000 },
  schemaVersion: 1,
})
