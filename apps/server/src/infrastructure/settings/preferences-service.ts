import {
  APPEARANCE_MODE,
  MODEL_THINKING_LEVEL,
  type AppearanceMode,
  type ModelThinkingLevel,
  type ToolPermission,
} from '@oh-my-harness/shared'
import { isToolPermission } from '@oh-my-harness/agent-policy'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

export interface PreferencesDocument {
  appearance: AppearanceMode
  budget: { dailyUsd: number | null; sessionUsd: number | null }
  defaultModel: { modelId: string; providerId: string }
  defaultPermission: ToolPermission
  defaultThinkingLevel: ModelThinkingLevel
  language: string
  retry: { enabled: boolean; maxRetries: number; maxRetryDelayMs: number }
  schemaVersion: 1
}

export interface PreferencesDiagnostic {
  code: 'PREFERENCES_INVALID' | 'PREFERENCES_READ_FAILED'
  message: string
}

export interface PreferencesSnapshot extends PreferencesDocument {
  diagnostic?: PreferencesDiagnostic
}

export class PreferencesError extends Error {
  readonly code: string
  readonly status: 400 | 500

  constructor(code: string, message: string, status: 400 | 500) {
    super(message)
    this.name = 'PreferencesError'
    this.code = code
    this.status = status
  }
}

const DEFAULT_PREFERENCES: PreferencesDocument = {
  appearance: APPEARANCE_MODE.SYSTEM,
  budget: { dailyUsd: null, sessionUsd: null },
  defaultModel: { modelId: '', providerId: '' },
  defaultPermission: 'workspace-write',
  defaultThinkingLevel: MODEL_THINKING_LEVEL.OFF,
  language: 'zh-CN',
  retry: { enabled: true, maxRetries: 1, maxRetryDelayMs: 30_000 },
  schemaVersion: 1,
}

const preferenceKeys = [
  'appearance',
  'budget',
  'defaultModel',
  'defaultPermission',
  'defaultThinkingLevel',
  'language',
  'retry',
  'schemaVersion',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isNullableBudget = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === 'number' && Number.isFinite(value) && value > 0)

const parseDocument = (value: unknown): PreferencesDocument => {
  if (!isRecord(value)) {
    throw new PreferencesError('INVALID_PREFERENCES', '偏好设置格式无效。', 400)
  }
  if (
    Object.keys(value).sort().join(',') !==
      preferenceKeys.slice().sort().join(',') ||
    value.schemaVersion !== 1 ||
    !Object.values(APPEARANCE_MODE).includes(
      value.appearance as AppearanceMode,
    ) ||
    typeof value.language !== 'string' ||
    !value.language.trim() ||
    value.language.length > 32 ||
    !isToolPermission(value.defaultPermission) ||
    !Object.values(MODEL_THINKING_LEVEL).includes(
      value.defaultThinkingLevel as ModelThinkingLevel,
    ) ||
    !isRecord(value.defaultModel) ||
    typeof value.defaultModel.providerId !== 'string' ||
    typeof value.defaultModel.modelId !== 'string' ||
    value.defaultModel.providerId.length > 512 ||
    value.defaultModel.modelId.length > 512 ||
    !isRecord(value.retry) ||
    typeof value.retry.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.retry.maxRetries) ||
    (value.retry.maxRetries as number) < 0 ||
    (value.retry.maxRetries as number) > 3 ||
    !Number.isSafeInteger(value.retry.maxRetryDelayMs) ||
    (value.retry.maxRetryDelayMs as number) < 0 ||
    (value.retry.maxRetryDelayMs as number) > 120_000 ||
    !isRecord(value.budget) ||
    !isNullableBudget(value.budget.sessionUsd) ||
    !isNullableBudget(value.budget.dailyUsd)
  ) {
    throw new PreferencesError('INVALID_PREFERENCES', '偏好设置格式无效。', 400)
  }
  return {
    appearance: value.appearance as AppearanceMode,
    budget: {
      dailyUsd: value.budget.dailyUsd as number | null,
      sessionUsd: value.budget.sessionUsd as number | null,
    },
    defaultModel: {
      modelId: value.defaultModel.modelId,
      providerId: value.defaultModel.providerId,
    },
    defaultPermission: value.defaultPermission,
    defaultThinkingLevel: value.defaultThinkingLevel as ModelThinkingLevel,
    language: value.language,
    retry: {
      enabled: value.retry.enabled,
      maxRetries: value.retry.maxRetries as number,
      maxRetryDelayMs: value.retry.maxRetryDelayMs as number,
    },
    schemaVersion: 1,
  }
}

/** 持久化应用偏好，并为 Agent Runtime 提供窄的运行策略读取入口。 */
export class PreferencesService {
  private readonly dataDirectory: string
  private readonly filePath: string
  private document?: PreferencesDocument
  private diagnostic?: PreferencesDiagnostic
  private mutation = Promise.resolve()

  constructor(dataDirectory: string) {
    this.dataDirectory = resolve(dataDirectory)
    this.filePath = join(this.dataDirectory, 'preferences.json')
  }

  async get(): Promise<PreferencesSnapshot> {
    const document = await this.readDocument()
    return this.diagnostic
      ? { ...document, diagnostic: this.diagnostic }
      : document
  }

  async getRuntimeSettings() {
    const document = await this.readDocument()
    return { budget: document.budget, retry: document.retry }
  }

  async replace(value: unknown): Promise<PreferencesSnapshot> {
    const document = parseDocument(value)
    await this.serialize(async () => {
      const temporaryPath = join(
        this.dataDirectory,
        `.preferences-${randomUUID()}.tmp`,
      )
      let handle: fs.FileHandle | undefined
      try {
        await fs.mkdir(this.dataDirectory, { mode: 0o700, recursive: true })
        await fs.chmod(this.dataDirectory, 0o700)
        handle = await fs.open(temporaryPath, 'wx', 0o600)
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        await fs.rename(temporaryPath, this.filePath)
        await fs.chmod(this.filePath, 0o600)
        this.document = document
        this.diagnostic = undefined
      } catch {
        await handle?.close().catch(() => undefined)
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        throw new PreferencesError(
          'PREFERENCES_PERSISTENCE_FAILED',
          '无法保存偏好设置。',
          500,
        )
      }
    })
    return this.get()
  }

  private async readDocument(): Promise<PreferencesDocument> {
    if (this.document) return this.document
    try {
      this.document = parseDocument(
        JSON.parse(await fs.readFile(this.filePath, 'utf8')),
      )
      await fs.chmod(this.dataDirectory, 0o700)
      await fs.chmod(this.filePath, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.document = structuredClone(DEFAULT_PREFERENCES)
      } else {
        this.document = structuredClone(DEFAULT_PREFERENCES)
        this.diagnostic = {
          code:
            error instanceof SyntaxError
              ? 'PREFERENCES_INVALID'
              : 'PREFERENCES_READ_FAILED',
          message: '偏好文件无效，已使用默认设置；原文件已保留。',
        }
      }
    }
    return this.document
  }

  private async serialize<T>(operation: () => Promise<T>) {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export const defaultPreferences = (): PreferencesDocument =>
  structuredClone(DEFAULT_PREFERENCES)
