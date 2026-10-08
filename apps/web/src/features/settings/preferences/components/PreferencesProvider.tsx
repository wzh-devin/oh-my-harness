import { APPEARANCE_MODE } from '@oh-my-harness/shared'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getPreferences, updatePreferences } from '../api.ts'
import { defaultPreferences, type PreferencesVo } from '../types.ts'

interface PreferencesContextValue {
  error: string | null
  isLoading: boolean
  preferences: PreferencesVo
  savePreferences: (next: PreferencesVo) => Promise<string>
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

const applyAppearance = (appearance: PreferencesVo['appearance']) => {
  const root = document.documentElement
  const dark =
    appearance === APPEARANCE_MODE.DARK ||
    (appearance === APPEARANCE_MODE.SYSTEM &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

/** 加载并持久化全局偏好，同时把主题应用到文档根节点。 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getPreferences()
      .then((next) => {
        if (!active) return
        setPreferences(next)
        setError(next.diagnostic?.message ?? null)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '偏好设置加载失败。',
          )
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    applyAppearance(preferences.appearance)
    if (preferences.appearance !== APPEARANCE_MODE.SYSTEM) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => applyAppearance(preferences.appearance)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [preferences.appearance])

  const savePreferences = useCallback(async (next: PreferencesVo) => {
    try {
      const saved = await updatePreferences(next)
      setPreferences(saved)
      setError(saved.diagnostic?.message ?? null)
      return ''
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : '偏好设置保存失败。'
      setError(message)
      return message
    }
  }, [])

  const value = useMemo(
    () => ({ error, isLoading, preferences, savePreferences }),
    [error, isLoading, preferences, savePreferences],
  )
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components -- Provider and its hook are one public preference boundary.
export const usePreferences = () => {
  const value = useContext(PreferencesContext)
  if (!value)
    throw new Error('usePreferences 必须在 PreferencesProvider 内使用。')
  return value
}
