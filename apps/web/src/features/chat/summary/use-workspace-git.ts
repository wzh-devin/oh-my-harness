import { useCallback, useEffect, useRef, useState } from 'react'
import {
  performGitAction,
  readWorkspaceGit,
  type GitActionInput,
  type WorkspaceGitVo,
} from './api/workspace-git-api.ts'

/** Git 快照按工作区隔离，取消过期读取；写入仍等待结果，避免重复执行。 */
export const useWorkspaceGit = (
  workspaceId: string | null | undefined,
  refreshKey: string,
) => {
  const [state, setState] = useState<{
    workspaceId?: string
    snapshot?: WorkspaceGitVo
    error?: string
    loading: boolean
  }>({ loading: false })
  const [isPending, setIsPending] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const mutationRef = useRef(false)
  const refresh = useCallback(async () => {
    requestRef.current?.abort()
    if (!workspaceId) return
    const controller = new AbortController()
    requestRef.current = controller
    setState((current) => ({
      workspaceId,
      snapshot:
        current.workspaceId === workspaceId ? current.snapshot : undefined,
      loading: true,
    }))
    try {
      const snapshot = await readWorkspaceGit(workspaceId, controller.signal)
      if (!controller.signal.aborted)
        setState({ workspaceId, snapshot, loading: false })
    } catch (error) {
      if (!controller.signal.aborted)
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Git 查询失败。',
        }))
    }
  }, [workspaceId])
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the selected workspace with its external Git state.
    void refresh()
    const handleFocus = () => {
      if (!mutationRef.current) void refresh()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      requestRef.current?.abort()
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh, refreshKey])

  /** 确认操作期间关闭重复提交；只把结果写回操作所属工作区。 */
  const perform = async (input: GitActionInput) => {
    if (!workspaceId || mutationRef.current) return false
    mutationRef.current = true
    setIsPending(true)
    requestRef.current?.abort()
    try {
      const snapshot = await performGitAction(workspaceId, input)
      setState((current) =>
        current.workspaceId === workspaceId
          ? { workspaceId, snapshot, loading: false }
          : current,
      )
      return true
    } catch (error) {
      setState((current) =>
        current.workspaceId === workspaceId
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : 'Git 操作失败。',
            }
          : current,
      )
      return false
    } finally {
      mutationRef.current = false
      setIsPending(false)
    }
  }
  const current = state.workspaceId === workspaceId ? state : undefined
  return {
    snapshot: current?.snapshot,
    error: current?.error,
    isLoading: !!workspaceId && (current?.loading ?? true),
    isPending,
    refresh,
    perform,
  }
}
export type WorkspaceGitController = ReturnType<typeof useWorkspaceGit>
