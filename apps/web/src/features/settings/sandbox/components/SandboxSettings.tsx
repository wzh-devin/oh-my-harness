import {
  SANDBOX_MODE,
  isSandboxMode,
  type SandboxMode,
} from '@oh-my-harness/shared'
import { useEffect, useState } from 'react'

import { SettingsSelect } from '../../dialog/components/SettingsSelect.tsx'
import {
  getSandboxSettings,
  updateSandboxSettings,
} from '../api/sandbox-settings-api.ts'

const SANDBOX_OPTIONS = [
  { id: SANDBOX_MODE.READ_ONLY, label: '只读' },
  { id: SANDBOX_MODE.WORKSPACE_WRITE, label: '工作区可写' },
  { id: SANDBOX_MODE.DANGER_FULL_ACCESS, label: '完全访问' },
] as const

/** 展示并持久化服务端命令沙箱模式。 */
export function SandboxSettings() {
  const [mode, setMode] = useState<SandboxMode>(SANDBOX_MODE.READ_ONLY)
  const [supported, setSupported] = useState(false)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getSandboxSettings()
      .then((settings) => {
        if (!active) return
        setMode(settings.mode)
        setSupported(settings.supported)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法读取沙箱设置。',
        )
      })
      .finally(() => {
        if (active) setIsPending(false)
      })
    return () => {
      active = false
    }
  }, [])

  const changeMode = async (value: string) => {
    if (!isSandboxMode(value)) return
    setError('')
    setIsPending(true)
    try {
      const settings = await updateSandboxSettings(value)
      setMode(settings.mode)
      setSupported(settings.supported)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '无法保存沙箱设置。',
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <SettingsSelect
      description={
        error ||
        (supported
          ? '设置工具和命令可访问的范围'
          : '当前系统暂不支持 macOS 沙箱')
      }
      isDisabled={isPending || !supported}
      label="沙箱设置"
      options={SANDBOX_OPTIONS}
      value={mode}
      onChange={(value) => void changeMode(value)}
    />
  )
}
