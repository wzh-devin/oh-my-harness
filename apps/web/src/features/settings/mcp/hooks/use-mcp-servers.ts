import { useEffect, useState } from 'react'
import { mcpApi } from '../api/mcp-api.ts'
import type { McpServerVo } from '../types/mcp-vo.ts'

/** 菜单或 MCP 草稿可见时订阅服务目录；请求串行，关闭后取消未完成请求。 */
export const useMcpServers = (enabled: boolean) => {
  const [state, setState] = useState<{
    servers?: McpServerVo[]
    error?: string
  }>({})
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const result = await mcpApi.list(controller.signal)
        if (!controller.signal.aborted) setState({ servers: result.servers })
      } catch {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            error: '读取 MCP 服务失败，正在重试。',
          }))
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled])
  return {
    servers: state.servers ?? [],
    message: state.error || (state.servers ? undefined : '正在读取 MCP 服务…'),
  }
}
