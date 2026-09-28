import { lazy, Suspense, useEffect, useState } from 'react'
import { Button, Tooltip } from '@heroui/react'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ServerIcon,
  XIcon,
} from 'lucide-react'
import { TOOL_EXECUTION_STATE } from '@oh-my-harness/shared'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../components/ui/collapsible.tsx'
import { readToolExecutionOutput } from '../../session/api/index.ts'
import type { ToolExecutionVo } from '../../session/types/index.ts'
import type { ToolExecutionsController } from '../use-tool-executions.ts'
import {
  EXECUTION_STATE_LABEL,
  getServiceCommandLabel,
} from '../service-executions.ts'
import { ServiceActions } from './ServiceSummary.tsx'

const ServiceLogViewer = lazy(() =>
  import('./ServiceLogViewer.tsx').then((module) => ({
    default: module.ServiceLogViewer,
  })),
)

/** 只展示用户点击的服务命令与真实输出；挂载、卸载均不启动或停止服务。 */
export function ToolExecutionConsole({
  execution,
  controller,
  onClose,
}: {
  execution: ToolExecutionVo
  controller: ToolExecutionsController
  onClose: () => void
}) {
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const command = execution.service?.command ?? ''
  const cwd = execution.service?.cwd ?? ''
  const workspaceName = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
  const running = execution.state === TOOL_EXECUTION_STATE.RUNNING
  const failed = execution.state === TOOL_EXECUTION_STATE.FAILED

  useEffect(() => {
    let active = true
    void readToolExecutionOutput(
      execution.sessionId,
      execution.executionId,
      0,
      256 * 1024,
    )
      .then((page) => {
        if (!active) return
        setOutput((page.truncated ? '[较早输出已截断]\n' : '') + page.text)
        setError('')
      })
      .catch((value: unknown) => {
        if (active)
          setError(
            value instanceof Error ? value.message : '无法读取服务输出。',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [execution])

  /** 复制完整原始命令与目录，失败反馈真实原因而不改变服务状态。 */
  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(`${command}\n\n工作目录：${cwd}`)
      setCopied(true)
      setCopyError('')
    } catch {
      setCopyError('复制失败，请手动选择命令复制。')
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label="服务控制台"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header className="flex h-[45px] shrink-0 items-center justify-between gap-3 border-b border-divider px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <ServerIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted"
          />
          <h2 className="truncate">服务控制台</h2>
        </div>
        <Button
          aria-label="关闭服务控制台"
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onClose}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <Collapsible className="shrink-0">
        <div className="flex min-w-0 items-center gap-2 px-4 pt-2.5">
          <p
            className="min-w-0 flex-1 truncate font-mono text-[13px]"
            title={command}
          >
            {getServiceCommandLabel(command, cwd)}
          </p>
          <span
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted"
            role="status"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${running ? 'bg-success' : failed ? 'bg-danger' : 'bg-muted'}`}
            />
            {EXECUTION_STATE_LABEL[execution.state]}
          </span>
          <ServiceActions execution={execution} controller={controller} />
        </div>
        <div className="flex min-w-0 items-center gap-2 px-4 pb-2 text-[11px] text-muted">
          <span className="truncate" title={cwd}>
            {workspaceName}
          </span>
          <span aria-hidden="true">·</span>
          <CollapsibleTrigger className="group flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">
            命令详情
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="max-h-48 overflow-auto">
          <div className="relative border-t border-divider bg-default/30 px-4 py-3 pr-12 text-xs">
            <Tooltip delay={300}>
              <Button
                aria-label="复制命令和目录"
                className="absolute top-2 right-3"
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => void copyDetails()}
              >
                {copied ? (
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                ) : (
                  <CopyIcon aria-hidden="true" className="size-3.5" />
                )}
              </Button>
              <Tooltip.Content>
                {copied ? '已复制' : '复制命令和目录'}
              </Tooltip.Content>
            </Tooltip>
            <p className="mb-1 text-[11px] text-muted">完整命令</p>
            <pre className="whitespace-pre-wrap break-all font-mono leading-5">
              {command}
            </pre>
            <p className="mt-2 mb-1 text-[11px] text-muted">工作目录</p>
            <p className="break-all font-mono leading-5">{cwd}</p>
            <span className="sr-only" role="status">
              {copied ? '命令和目录已复制' : ''}
            </span>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {error || copyError || execution.error || controller.error ? (
        <p
          className="border-b border-divider px-4 py-2 text-xs text-danger"
          role="status"
        >
          {error || copyError || execution.error || controller.error}
        </p>
      ) : null}
      {output ? (
        <Suspense
          fallback={
            <p
              className="flex-1 bg-[#18191b] p-4 text-xs text-zinc-400"
              role="status"
            >
              正在加载日志视图…
            </p>
          }
        >
          <ServiceLogViewer output={output} />
        </Suspense>
      ) : (
        <p
          className="flex-1 bg-[#18191b] p-4 text-xs text-zinc-400"
          role="status"
        >
          {loading ? '正在读取输出…' : '暂无输出'}
        </p>
      )}
    </section>
  )
}
