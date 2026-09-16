import { useEffect, useState } from 'react'
import { pluginApi } from '../api/plugin-api.ts'
import type { PluginInstallationVo } from '../types/plugin-vo.ts'

/** 仅在 @ 菜单或插件标签存在时刷新安装状态。 */
export const useInstalledPlugins = (enabled: boolean) => {
  const [state, setState] = useState<{
    installations?: PluginInstallationVo[]
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
        const result = await pluginApi.list(controller.signal)
        if (!controller.signal.aborted)
          setState({ installations: result.installations })
      } catch {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            error: '读取已安装插件失败，正在重试。',
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
    installations: state.installations ?? [],
    message:
      state.error || (state.installations ? undefined : '正在读取已安装插件…'),
  }
}
