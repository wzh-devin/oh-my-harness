import { CheckCircle2Icon, ChevronUpIcon, LoaderCircleIcon } from 'lucide-react'
import type { ChatStatus } from '@agile-avocation/ui-pro/prompt-input'
import { AgentPlan } from '../../components/ui/agent-plan.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible.tsx'
import type { ChatTodoItem } from '../../features/chat/index.ts'
import {
  getTodoProgress,
  toPlanSteps,
} from '../../features/chat/summary/todo-progress.ts'

interface TodoPanelProps {
  status: ChatStatus
  todos?: readonly ChatTodoItem[]
}

/** 在输入框上方展示计划胶囊，并在胶囊下方展开完整步骤。 */
export function TodoPanel({ status, todos }: TodoPanelProps) {
  if (!todos?.length) return null

  const progress = getTodoProgress(todos)
  const planSteps = toPlanSteps(todos)
  const isComplete = progress.completed === progress.total
  const isRunning = status === 'submitted' || status === 'streaming'
  if (!isComplete && !isRunning) return null
  const StatusIcon = isComplete ? CheckCircle2Icon : LoaderCircleIcon

  return (
    <Collapsible className="mb-3 flex flex-col items-center gap-2">
      <CollapsibleTrigger
        className="group/trigger flex h-9 w-fit max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full border border-divider bg-surface px-3 text-left text-foreground shadow-xs transition-[background-color,transform] hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.98] active:bg-surface-tertiary sm:max-w-[28rem] motion-reduce:transition-none"
        title={progress.description}
      >
        <StatusIcon
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${
            isComplete
              ? 'text-success'
              : 'animate-spin text-accent motion-reduce:animate-none'
          }`}
        />
        <span className="sr-only">计划进度：</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          第 {progress.current} / {progress.total} 步
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-muted">
          ·
        </span>
        <span
          aria-live="polite"
          className="min-w-0 truncate text-xs text-muted"
        >
          {progress.description}
        </span>
        <ChevronUpIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted transition-transform group-data-open/trigger:rotate-180 group-data-panel-open/trigger:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="h-(--collapsible-panel-height) w-full overflow-hidden transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <AgentPlan steps={planSteps} />
      </CollapsibleContent>
    </Collapsible>
  )
}
