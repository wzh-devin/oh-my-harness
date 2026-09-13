import { useCallback, useEffect, useRef, useState } from 'react'
import { mcpApi } from '../api/mcp-api.ts'
import type { McpListVo } from '../types/mcp-vo.ts'

/** 只在 MCP 页面挂载时刷新状态；编辑请求串行，卸载取消并丢弃所有草稿回调。 */
export function useMcpSettings() {
  const [list, setList] = useState<McpListVo>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const action = useRef<AbortController | null>(null)
  const polling = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const refresh = useCallback(async () => {
    if (action.current || polling.current || !mounted.current) return
    const controller = new AbortController()
    polling.current = controller
    try {
      const next = await mcpApi.list(controller.signal)
      if (!controller.signal.aborted && mounted.current) setList(next)
    } catch {
      if (!controller.signal.aborted && mounted.current)
        setError('无法读取 MCP 服务，请重试。')
    } finally {
      if (polling.current === controller) polling.current = null
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // oxlint-disable-next-line react/set-state-in-effect -- 远端状态订阅，setState 仅在请求完成后调用。
    void refresh()
    const interval = setInterval(() => {
      void refresh()
    }, 3000)
    return () => {
      mounted.current = false
      clearInterval(interval)
      polling.current?.abort()
      polling.current = null
      action.current?.abort()
    }
  }, [refresh])

  const run = useCallback(
    async <T>(
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> => {
      if (action.current) return undefined
      const controller = new AbortController()
      action.current = controller
      polling.current?.abort()
      setBusy(true)
      setError('')
      try {
        const result = await operation(controller.signal)
        return !controller.signal.aborted && mounted.current
          ? result
          : undefined
      } catch (error) {
        if (!controller.signal.aborted && mounted.current)
          setError(
            error instanceof Error ? error.message : 'MCP 操作失败，请重试。',
          )
      } finally {
        if (action.current === controller) action.current = null
        if (mounted.current) {
          setBusy(false)
          void refresh()
        }
      }
    },
    [refresh],
  )

  return {
    list,
    busy,
    error,
    setError,
    run,
    setList,
    cancel: () => action.current?.abort(),
  }
}
