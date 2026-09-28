import { useEffect, useRef, useState } from 'react'
import {
  TOOL_EXECUTION_ACTION,
  type ToolExecutionAction,
} from '@oh-my-harness/shared'
import {
  removeToolExecutionService,
  restartToolExecution,
  stopToolExecution,
  subscribeToolExecutions,
} from '../session/api/index.ts'
import type { ToolExecutionVo } from '../session/types/index.ts'
import { selectServices } from './service-executions.ts'

const executionActions = {
  [TOOL_EXECUTION_ACTION.STOP]: stopToolExecution,
  [TOOL_EXECUTION_ACTION.RESTART]: restartToolExecution,
  [TOOL_EXECUTION_ACTION.REMOVE_SERVICE]: removeToolExecutionService,
}

const mergeExecution = (
  executionList: readonly ToolExecutionVo[],
  next: ToolExecutionVo,
) =>
  [
    ...executionList.filter(
      (execution) => execution.executionId !== next.executionId,
    ),
    next,
  ].sort((left, right) => left.startedAt - right.startedAt)

/** 会话持有执行订阅；控制台只选择查看哪一项，不拥有服务生命周期。 */
export const useToolExecutions = (
  sessionId: string | undefined,
  refreshApproval: (sessionId: string) => Promise<unknown>,
  onServiceRemoved: () => void,
) => {
  const [snapshot, setSnapshot] = useState<{
    sessionId?: string
    executionList: ToolExecutionVo[]
    error: string
  }>({ executionList: [], error: '' })
  const [pendingId, setPendingId] = useState<string>()
  const [actionError, setActionError] = useState<{
    sessionId: string
    message: string
  }>()
  const pendingRef = useRef(false)
  const sessionRef = useRef(sessionId)
  const executionList =
    snapshot.sessionId === sessionId ? snapshot.executionList : []
  const serviceList = selectServices(executionList)

  useEffect(() => {
    sessionRef.current = sessionId
    if (!sessionId) return
    let active = true
    const unsubscribe = subscribeToolExecutions(sessionId, {
      onError: () => {
        if (active)
          setSnapshot((current) => ({
            executionList:
              current.sessionId === sessionId ? current.executionList : [],
            sessionId,
            error: '服务状态连接已断开，正在重连…',
          }))
      },
      onSnapshot: (next) => {
        if (active)
          setSnapshot({
            sessionId,
            executionList: next.filter(
              (execution) => execution.sessionId === sessionId,
            ),
            error: '',
          })
      },
      onExecution: (execution) => {
        if (!active || execution.sessionId !== sessionId) return
        setSnapshot((current) => ({
          sessionId,
          executionList: mergeExecution(
            current.sessionId === sessionId ? current.executionList : [],
            execution,
          ),
          error: '',
        }))
      },
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [sessionId])

  /** 操作目标始终绑定当前会话和真实执行；重启复用审批，重复点击不会再次启动。 */
  const mutate = async (
    execution: ToolExecutionVo,
    action: ToolExecutionAction,
  ) => {
    if (!sessionId || execution.sessionId !== sessionId || pendingRef.current)
      return
    pendingRef.current = true
    setActionError(undefined)
    setPendingId(execution.executionId)
    const approvalPoll =
      action === TOOL_EXECUTION_ACTION.RESTART
        ? window.setInterval(
            () => void refreshApproval(sessionId).catch(() => undefined),
            250,
          )
        : undefined
    try {
      const next = await executionActions[action](
        sessionId,
        execution.executionId,
      )
      if (sessionRef.current === sessionId) {
        setSnapshot((current) => ({
          sessionId,
          executionList: mergeExecution(
            current.sessionId === sessionId ? current.executionList : [],
            next,
          ),
          error: '',
        }))
        if (action === TOOL_EXECUTION_ACTION.REMOVE_SERVICE) onServiceRemoved()
      }
      return next
    } catch (error) {
      if (sessionRef.current === sessionId)
        setActionError({
          sessionId,
          message: error instanceof Error ? error.message : '服务操作失败。',
        })
    } finally {
      if (approvalPoll !== undefined) window.clearInterval(approvalPoll)
      if (action === TOOL_EXECUTION_ACTION.RESTART)
        void refreshApproval(sessionId).catch(() => undefined)
      pendingRef.current = false
      setPendingId(undefined)
    }
  }

  return {
    executionList,
    serviceList,
    pendingId,
    mutate,
    error:
      (actionError?.sessionId === sessionId ? actionError?.message : '') ||
      (snapshot.sessionId === sessionId ? snapshot.error : ''),
  }
}

export type ToolExecutionsController = ReturnType<typeof useToolExecutions>
