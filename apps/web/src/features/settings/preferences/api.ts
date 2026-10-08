import type { PreferencesVo } from './types.ts'

export class PreferencesApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'PreferencesApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined
    throw new PreferencesApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code ?? 'PREFERENCES_REQUEST_FAILED',
      response.status,
    )
  }
  return (await response.json()) as T
}

export const getPreferences = () =>
  request<PreferencesVo>('/api/settings/preferences')

export const updatePreferences = (preferences: PreferencesVo) =>
  request<PreferencesVo>('/api/settings/preferences', {
    body: JSON.stringify(preferences),
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
  })
