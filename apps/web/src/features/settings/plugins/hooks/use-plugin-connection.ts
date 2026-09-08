import { useEffect, useRef, useState } from 'react'
import { MCP_OAUTH_STATUS } from '@oh-my-harness/shared'
import { pluginRequest, type PluginOAuthVo } from '../api/plugin-api.ts'

/** 管理连接配置与短期 OAuth 状态；凭据只随请求提交，不持久化到浏览器。 */
export const usePluginConnection = (onChanged: () => void) => {
  const pending = useRef(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checkedTools, setCheckedTools] = useState<number | null>(null)
  const [session, setSession] = useState<PluginOAuthVo | null>(null)
  useEffect(() => {
    if (session?.status !== MCP_OAUTH_STATUS.PENDING) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () =>
        void pluginRequest<PluginOAuthVo>(
          `plugin-oauth-sessions/${session.id}`,
          { signal: controller.signal },
        )
          .then((value) => {
            if (controller.signal.aborted) return
            setSession(value)
            if (value.status !== MCP_OAUTH_STATUS.PENDING) onChanged()
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) setError((error as Error).message)
          }),
      1000,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [session, onChanged])
  const perform = async (fn: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
      onChanged()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return {
    editing,
    setEditing,
    busy,
    error,
    checkedTools,
    setCheckedTools,
    session,
    setSession,
    perform,
  }
}
