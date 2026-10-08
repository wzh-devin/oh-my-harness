import type {
  AppearanceMode,
  ModelThinkingLevel,
  ToolPermission,
} from '@oh-my-harness/shared'

export interface PreferencesDto {
  appearance: AppearanceMode
  budget: { dailyUsd: number | null; sessionUsd: number | null }
  defaultModel: { modelId: string; providerId: string }
  defaultPermission: ToolPermission
  defaultThinkingLevel: ModelThinkingLevel
  language: string
  retry: { enabled: boolean; maxRetries: number; maxRetryDelayMs: number }
  schemaVersion: 1
}

export interface PreferencesSnapshotDto extends PreferencesDto {
  diagnostic?: { code: string; message: string }
}
