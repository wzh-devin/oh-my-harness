import { useCallback, useEffect, useRef, useState } from 'react'
import { PLUGIN_OPERATION_STATUS } from '@oh-my-harness/shared'
import { pluginApi } from '../api/plugin-api.ts'
import type {
  PluginCatalogVo,
  PluginListVo,
  PluginOperationVo,
} from '../types/plugin-vo.ts'

/** 管理市场查询、安装暂存和互斥写请求，关闭页面释放临时任务与凭据请求。 */
export const usePluginSettings = (
  query: string,
  category: string,
  offset: number,
  market: string,
  refreshCapabilities: () => void,
) => {
  const [catalog, setCatalog] = useState<PluginCatalogVo>()
  const [list, setList] = useState<PluginListVo>()
  const [operation, setOperation] = useState<PluginOperationVo>()
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const action = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const operationId = useRef<string | undefined>(undefined)
  const refreshRef = useRef(refreshCapabilities)
  useEffect(() => {
    refreshRef.current = refreshCapabilities
  }, [refreshCapabilities])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || action.current) return
      pending = true
      try {
        const result = await pluginApi.list(controller.signal)
        if (!controller.signal.aborted && !action.current) {
          setList((previous) =>
            !previous || result.revision >= previous.revision
              ? result
              : previous,
          )
          setListError('')
        }
      } catch (error) {
        if (!controller.signal.aborted) setListError((error as Error).message)
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      mounted.current = false
      controller.abort()
      clearInterval(timer)
      action.current?.abort()
      const id = operationId.current
      if (id)
        void pluginApi
          .cancel(new AbortController().signal, id)
          .catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      void pluginApi
        .catalog(controller.signal, query, category, offset, market)
        .then((result) => {
          if (!controller.signal.aborted) {
            setCatalog(result)
            setCatalogError('')
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setCatalogError((error as Error).message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, category, offset, market, reload])

  useEffect(() => {
    if (operation?.status !== PLUGIN_OPERATION_STATUS.FETCHING) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void pluginApi
        .operation(controller.signal, operation.id)
        .then((result) => {
          if (
            !controller.signal.aborted &&
            operationId.current === operation.id
          )
            setOperation(result)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setError((error as Error).message)
            setOperation((current) =>
              current
                ? { ...current, status: PLUGIN_OPERATION_STATUS.FAILED }
                : undefined,
            )
          }
        })
    }, 500)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [operation])

  const run = useCallback(
    async <T>(
      work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> => {
      if (action.current) return undefined
      const controller = new AbortController()
      action.current = controller
      setBusy(true)
      setError('')
      try {
        const result = await work(controller.signal)
        return mounted.current && !controller.signal.aborted
          ? result
          : undefined
      } catch (error) {
        if (mounted.current && !controller.signal.aborted)
          setError((error as Error).message)
      } finally {
        if (action.current === controller) action.current = null
        if (mounted.current) setBusy(false)
      }
    },
    [],
  )
  const mutate = async (
    work: (signal: AbortSignal) => Promise<PluginListVo>,
  ) => {
    const result = await run(work)
    if (result) {
      setList((previous) =>
        !previous || result.revision >= previous.revision ? result : previous,
      )
      refreshRef.current()
    }
    return result
  }
  const startOperation = async (
    work: (signal: AbortSignal) => Promise<PluginOperationVo>,
  ) => {
    const result = await run(async (signal) => {
      if (operationId.current)
        await pluginApi.cancel(signal, operationId.current)
      const next = await work(signal)
      operationId.current = next.id
      return next
    })
    if (result) setOperation(result)
    return result
  }
  const prepare = (entryId: string) =>
    startOperation((signal) => pluginApi.prepare(signal, entryId))
  const prepareDirect = (source: { url: string; ref: string; path: string }) =>
    startOperation((signal) => pluginApi.prepareDirect(signal, source))
  const cancel = async () => {
    if (!operationId.current) {
      setOperation(undefined)
      return true
    }
    const done = await run(async (signal) => {
      await pluginApi.cancel(signal, operationId.current!)
      return true
    })
    if (done) {
      operationId.current = undefined
      setOperation(undefined)
    }
    return done
  }
  return {
    catalog,
    list,
    operation,
    error: error || listError || catalogError,
    setError,
    busy,
    loading,
    run,
    abortRequest: () => action.current?.abort(),
    mutate,
    prepare,
    prepareDirect,
    cancel,

    retryCatalog: () => setReload((value) => value + 1),
    refreshCatalog: async () => {
      const result = await run((signal) => pluginApi.refresh(signal))
      if (result) setReload((value) => value + 1)
    },
  }
}
