import type { RunRecoveryAction, RunStatus } from '@oh-my-harness/shared'
import type { RunPageVo } from './types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined
    throw new Error(body?.message ?? `请求失败（${response.status}）`)
  }
  return (await response.json()) as T
}

export const listRuns = (status?: RunStatus) => {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return request<RunPageVo>(`/api/agent/runs${query}`)
}

export const recoverRun = (runId: string, action: RunRecoveryAction) =>
  request<{ action: RunRecoveryAction; runId: string; sessionId: string }>(
    `/api/agent/runs/${encodeURIComponent(runId)}/recover`,
    {
      body: JSON.stringify({ action }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  )
