import type { SandboxMode } from '@oh-my-harness/shared'

export interface SandboxSettingsVo {
  mode: SandboxMode
  supported: boolean
}

const request = async (init?: RequestInit): Promise<SandboxSettingsVo> => {
  const response = await fetch('/api/settings/sandbox', init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined
    throw new Error(body?.message ?? `沙箱设置请求失败（${response.status}）`)
  }
  return (await response.json()) as SandboxSettingsVo
}

export const getSandboxSettings = () => request()

export const updateSandboxSettings = (mode: SandboxMode) =>
  request({
    body: JSON.stringify({ mode }),
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
  })
