import { useId } from 'react'
import { Button, Tooltip } from '@heroui/react'
import { RotateCcwIcon, SquareIcon, ServerIcon, Trash2Icon } from 'lucide-react'
import {
  TOOL_EXECUTION_ACTION,
  TOOL_EXECUTION_STATE,
} from '@oh-my-harness/shared'
import type { ToolExecutionVo } from '../../session/types/index.ts'
import type { ToolExecutionsController } from '../use-tool-executions.ts'
import {
  EXECUTION_STATE_LABEL,
  getServiceCommandLabel,
} from '../service-executions.ts'

/** 简介只列真实声明的常驻服务，点击行才打开该命令的控制台。 */
export function ServiceSummary({
  controller,
  onOpen,
}: {
  controller: ToolExecutionsController
  onOpen: (execution: ToolExecutionVo, trigger: HTMLButtonElement) => void
}) {
  const headingId = useId()
  if (!controller.serviceList.length) return null
  return (
    <section className="summary-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="summary-heading">
        服务
      </h2>
      {controller.serviceList.map((execution) => (
        <div
          className="flex min-w-0 items-center gap-1"
          key={execution.executionId}
        >
          <button
            className="summary-row summary-action min-w-0 flex-1"
            type="button"
            title={execution.service?.command}
            onClick={(event) => onOpen(execution, event.currentTarget)}
          >
            <ServerIcon aria-hidden="true" className="text-muted" />
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-5">
                {getServiceCommandLabel(
                  execution.service?.command ?? '',
                  execution.service?.cwd ?? '',
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] leading-4 text-muted">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${execution.state === TOOL_EXECUTION_STATE.RUNNING ? 'bg-success' : execution.state === TOOL_EXECUTION_STATE.FAILED ? 'bg-danger' : 'bg-muted'}`}
                />
                {EXECUTION_STATE_LABEL[execution.state]}
              </span>
            </span>
          </button>
          <ServiceActions execution={execution} controller={controller} />
        </div>
      ))}
      {controller.error ? (
        <p className="summary-empty" role="status">
          {controller.error}
        </p>
      ) : null}
    </section>
  )
}

/** 操作按钮与查看日志入口分离，避免停止或重启顺带打开控制台。 */
export function ServiceActions({
  execution,
  controller,
}: {
  execution: ToolExecutionVo
  controller: ToolExecutionsController
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {execution.canRestart ? (
        <Tooltip delay={300}>
          <Button
            className="summary-refresh"
            aria-label={`重启 ${execution.service?.command ?? '服务'}`}
            isIconOnly
            size="sm"
            variant="ghost"
            isDisabled={Boolean(controller.pendingId)}
            onPress={() =>
              void controller.mutate(execution, TOOL_EXECUTION_ACTION.RESTART)
            }
          >
            <RotateCcwIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Tooltip.Content>重启服务</Tooltip.Content>
        </Tooltip>
      ) : null}
      {execution.canStop ? (
        <Tooltip delay={300}>
          <Button
            className="summary-refresh"
            aria-label={`停止 ${execution.service?.command ?? '服务'}`}
            isIconOnly
            size="sm"
            variant="ghost"
            isDisabled={Boolean(controller.pendingId)}
            onPress={() =>
              void controller.mutate(execution, TOOL_EXECUTION_ACTION.STOP)
            }
          >
            <SquareIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Tooltip.Content>停止服务</Tooltip.Content>
        </Tooltip>
      ) : null}
      <Tooltip delay={300}>
        <Button
          className="summary-refresh hover:text-danger"
          aria-label={`删除并停止 ${execution.service?.command ?? '服务'}`}
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={Boolean(controller.pendingId)}
          onPress={() =>
            void controller.mutate(
              execution,
              TOOL_EXECUTION_ACTION.REMOVE_SERVICE,
            )
          }
        >
          <Trash2Icon aria-hidden="true" className="size-3.5" />
        </Button>
        <Tooltip.Content>删除并停止服务</Tooltip.Content>
      </Tooltip>
    </div>
  )
}
