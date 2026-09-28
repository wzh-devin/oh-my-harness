import {
  useScrollLock,
  type ToolCallMessagePartStatus,
} from '@assistant-ui/react'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  LoaderIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { cn } from '../../lib/index.ts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.tsx'
import type { ToolFallbackRootProps } from '../../types/assistant-ui/tool-fallback.ts'

const ANIMATION_DURATION = 200

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll()
      if (!isControlled) setUncontrolledOpen(open)
      controlledOnOpenChange?.(open)
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        'aui-tool-fallback-root group/tool-fallback-root w-full',
        className,
      )}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  )
}

type ToolStatus = ToolCallMessagePartStatus['type']

const statusIconMap: Record<
  Exclude<ToolStatus, 'complete'>,
  React.ElementType
> = {
  running: LoaderIcon,
  incomplete: XCircleIcon,
  'requires-action': AlertCircleIcon,
}

function ToolFallbackTrigger({
  background = false,
  toolName,
  status,
  icon,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<typeof CollapsibleTrigger>, 'className'> & {
  className?: string
  background?: boolean
  icon?: React.ElementType
  label?: string
  status?: ToolCallMessagePartStatus
  toolName: string
}) {
  const statusType = status?.type ?? 'complete'
  const isBackground = statusType === 'running' && background
  const isRunning = statusType === 'running' && !background
  const isCancelled =
    status?.type === 'incomplete' && status.reason === 'cancelled'
  let Icon = icon ?? WrenchIcon
  if (statusType !== 'complete') Icon = statusIconMap[statusType]
  if (isBackground) Icon = icon ?? TerminalIcon
  let fallbackLabel = `已使用 ${toolName}`
  if (statusType === 'running')
    fallbackLabel = background
      ? `后台运行中 · ${toolName}`
      : `正在使用 ${toolName}`
  if (statusType === 'incomplete')
    fallbackLabel = isCancelled ? `已取消 ${toolName}` : `${toolName} 调用失败`

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      data-background={isBackground || undefined}
      aria-busy={isRunning}
      className={cn(
        'aui-tool-fallback-trigger group/trigger flex min-w-0 w-fit origin-left items-center gap-2 py-1 text-sm font-normal text-muted transition-[color,scale] hover:text-foreground active:scale-[0.98]',
        className,
      )}
      {...props}
    >
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn(
          'aui-tool-fallback-trigger-icon size-4 shrink-0',
          isCancelled && 'text-muted',
          isRunning &&
            'animate-spin [animation-duration:0.6s] motion-reduce:animate-none',
        )}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          'aui-tool-fallback-trigger-label-wrapper min-w-0 text-start leading-5',
          isCancelled && 'text-muted line-through',
          isRunning && 'shimmer motion-reduce:animate-none',
        )}
      >
        {statusType === 'complete' && label ? label : fallbackLabel}
      </span>
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className="aui-tool-fallback-trigger-chevron size-3.5 shrink-0 -rotate-90 transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-0 group-data-panel-open/trigger:rotate-0 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  )
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof CollapsibleContent>, 'className'> & {
  className?: string
}) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        'aui-tool-fallback-content group/collapsible-content relative overflow-hidden text-sm text-muted outline-none ease-[cubic-bezier(0.32,0.72,0,1)]',
        'data-closed:pointer-events-none data-closed:animate-collapsible-up data-closed:fill-mode-forwards data-open:animate-collapsible-down motion-reduce:animate-none',
        '[--tw-duration:var(--animation-duration)]',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2 pt-1 pb-2 ps-6 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/collapsible-content:animate-in group-data-open/collapsible-content:fade-in-0 group-data-open/collapsible-content:blur-in-[2px] group-data-open/collapsible-content:slide-in-from-top-1 group-data-closed/collapsible-content:animate-out group-data-closed/collapsible-content:fade-out-0 group-data-closed/collapsible-content:blur-out-[2px] group-data-closed/collapsible-content:slide-out-to-top-1 group-data-open/collapsible-content:animation-duration-(--animation-duration) group-data-closed/collapsible-content:animation-duration-(--animation-duration) motion-reduce:animate-none">
        {children}
      </div>
    </CollapsibleContent>
  )
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & { argsText?: string }) {
  if (!argsText) return null

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn('aui-tool-fallback-args', className)}
      {...props}
    >
      <pre className="aui-tool-fallback-args-value rounded-md bg-surface-secondary px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap text-foreground/80">
        {argsText}
      </pre>
    </div>
  )
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & { result?: unknown }) {
  if (result === undefined) return null

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn('aui-tool-fallback-result', className)}
      {...props}
    >
      <p className="aui-tool-fallback-result-header text-[11px] font-normal text-muted">
        结果：
      </p>
      <pre className="aui-tool-fallback-result-content mt-1 rounded-md bg-surface-secondary px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap text-foreground/80">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & { status?: ToolCallMessagePartStatus }) {
  if (status?.type !== 'incomplete') return null

  const errorText = status.error
    ? typeof status.error === 'string'
      ? status.error
      : JSON.stringify(status.error)
    : null
  if (!errorText) return null

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn('aui-tool-fallback-error', className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header font-medium text-danger">
        {status.reason === 'cancelled' ? '取消原因：' : '错误：'}
      </p>
      <p className="aui-tool-fallback-error-reason text-danger">{errorText}</p>
    </div>
  )
}

export {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
}
