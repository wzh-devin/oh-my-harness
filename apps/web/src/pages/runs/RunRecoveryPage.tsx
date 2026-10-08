import { useCallback, useEffect, useState } from 'react'
import { Button, Card } from '@heroui/react'
import {
  RUN_RECOVERY_ACTION,
  RUN_STATUS,
  type RunRecoveryAction,
  type RunStatus,
} from '@oh-my-harness/shared'
import {
  listRuns,
  recoverRun,
  type RunSummaryVo,
} from '../../features/runs/index.ts'

interface RunRecoveryPageProps {
  onNavigate: (path: string) => void
}

const statusLabels: Record<RunStatus, string> = {
  [RUN_STATUS.ABORTED]: '已中止',
  [RUN_STATUS.COMPLETED]: '已完成',
  [RUN_STATUS.FAILED]: '失败',
  [RUN_STATUS.INTERRUPTED]: '已中断',
  [RUN_STATUS.RUNNING]: '运行中',
}

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  })

/** 展示可继续或重试的历史 Run，并复用 Session 页面查看恢复结果。 */
export function RunRecoveryPage({ onNavigate }: RunRecoveryPageProps) {
  const [status, setStatus] = useState<RunStatus | ''>('')
  const [items, setItems] = useState<RunSummaryVo[]>([])
  const [error, setError] = useState('')
  const [busyRunId, setBusyRunId] = useState<string>()

  const load = useCallback(async () => {
    try {
      setError('')
      const page = await listRuns(status || undefined)
      setItems(page.items)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '运行记录加载失败。')
    }
  }, [status])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Run list synchronizes with the selected server-side filter.
    void load()
  }, [load])

  const handleRecover = async (
    run: RunSummaryVo,
    action: RunRecoveryAction,
  ) => {
    setBusyRunId(run.runId)
    setError('')
    try {
      const result = await recoverRun(run.runId, action)
      onNavigate(`/${result.sessionId}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '运行恢复失败。')
    } finally {
      setBusyRunId(undefined)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            运行恢复中心
          </h1>
          <p className="mt-2 text-sm text-muted">
            服务重启后未完成的运行可以继续；模型请求失败的运行可以重试。工具不会自动重放。
          </p>
        </div>
        <select
          aria-label="运行状态"
          className="h-9 max-w-xs rounded-lg border border-divider bg-surface px-3 text-sm text-foreground"
          value={status}
          onChange={(event) =>
            setStatus(event.currentTarget.value as RunStatus | '')
          }
        >
          <option value="">全部状态</option>
          {Object.values(RUN_STATUS).map((value) => (
            <option key={value} value={value}>
              {statusLabels[value]}
            </option>
          ))}
        </select>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {items.length ? (
          <div className="grid gap-3">
            {items.map((run) => (
              <Card
                key={run.runId}
                className="border border-divider bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        {statusLabels[run.status]}
                      </span>
                      <span className="text-xs text-muted">
                        {formatTime(run.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted">
                      {run.providerId} / {run.modelId}
                    </p>
                    {run.errorMessage ? (
                      <p className="mt-2 text-sm text-danger">
                        {run.errorMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-muted">
                    <div>{run.tokenUsage.total.toLocaleString()} tokens</div>
                    <div>
                      {run.cost.total > 0
                        ? `$${run.cost.total.toFixed(4)}`
                        : '成本不可用'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {run.recoveryAction ? (
                    <Button
                      isDisabled={busyRunId !== undefined}
                      size="sm"
                      onPress={() =>
                        void handleRecover(run, run.recoveryAction!)
                      }
                    >
                      {busyRunId === run.runId
                        ? '处理中…'
                        : run.recoveryAction === RUN_RECOVERY_ACTION.CONTINUE
                          ? '继续运行'
                          : '重新生成'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => onNavigate(`/${run.sessionId}`)}
                  >
                    打开会话
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border border-divider bg-surface p-8 text-center text-sm text-muted">
            暂无符合条件的运行记录。
          </Card>
        )}
      </div>
    </div>
  )
}
