import { useEffect, useState } from 'react'
import { searchAgentTrace } from '../api/agent-trace-api.ts'

/** 查询防抖、日志更新后重查；取消和身份校验共同阻止旧结果覆盖新筛选。 */
export const useTraceSearch = (
  sessionId: string,
  query: string,
  sequence: number,
  retry: number,
) => {
  const [result, setResult] = useState<{
    sessionId: string
    query: string
    recordIds: ReadonlySet<string>
    error: string
    pending: boolean
  } | null>(null)
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setResult((previous) => ({
        sessionId,
        query,
        error: '',
        pending: true,
        recordIds:
          previous?.sessionId === sessionId && previous.query === query
            ? previous.recordIds
            : new Set(),
      }))
      void searchAgentTrace(sessionId, query, controller.signal)
        .then((recordIds) => {
          if (!controller.signal.aborted)
            setResult({
              sessionId,
              query,
              recordIds,
              pending: false,
              error: '',
            })
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              sessionId,
              query,
              recordIds: new Set(),
              pending: false,
              error: cause instanceof Error ? cause.message : '轨迹搜索失败。',
            })
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId, query, sequence, retry])
  const current =
    result?.sessionId === sessionId && result.query === query ? result : null
  return {
    recordIds: query ? (current?.recordIds ?? new Set<string>()) : null,
    pending: Boolean(query && (!current || current.pending)),
    error: query ? (current?.error ?? '') : '',
  }
}
