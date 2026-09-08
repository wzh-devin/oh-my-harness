import { useEffect, useState } from 'react'
import { MESSAGE_PART_TYPE, TOOL_EXECUTION_STATE } from '@oh-my-harness/shared'
import { ChatMessage as ChatMessagePrimitive } from '@agile-avocation/ui-pro/chat-message'
import { TextShimmer } from '@agile-avocation/ui-pro/text-shimmer'
import {
  ChevronDownIcon,
  LoaderCircleIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../components/ui/index.ts'
import type {
  ChatAssistantStatus,
  ChatMessageActivity,
  ChatMessageTool,
} from '../../data/chat-types.ts'
import {
  getToolGroupLabel,
  getToolActivitySummary,
  groupConsecutiveToolParts,
  isToolActivityRunning,
} from '../utils/tool-display.ts'
import { MessageMarkdown } from './MessageMarkdown.tsx'
import { MessageTool } from './MessageTool.tsx'
import { ReasoningPanel } from './ReasoningPanel.tsx'

interface ToolActivityProps {
  activity: ChatMessageActivity
  status?: ChatAssistantStatus
}

const ACTIVITY_ICONS = {
  complete: WrenchIcon,
  failed: XCircleIcon,
  running: LoaderCircleIcon,
} as const

/** 折叠展示同一文本区间内的连续工具调用。 */
function ToolCallGroup({ tools }: { tools: readonly ChatMessageTool[] }) {
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="group/tool-group-trigger flex max-w-full min-w-0 w-fit items-center gap-2 rounded-md py-1 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <WrenchIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{getToolGroupLabel(tools)}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 -rotate-90 transition-transform group-data-panel-open/tool-group-trigger:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden pl-5 data-closed:animate-collapsible-up data-open:animate-collapsible-down motion-reduce:animate-none">
        <div className="flex flex-col gap-1 py-1">
          {tools.map((tool, index) => (
            <MessageTool
              key={tool.toolCallId ?? `${tool.toolName}-${index}`}
              tool={tool}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 默认折叠连续工具调用，并保留可展开的过程详情。 */
export function ToolActivity({ activity, status }: ToolActivityProps) {
  const [now, setNow] = useState(() => Date.now())
  const hasEnded = activity.endedAt !== undefined
  const isRunning = isToolActivityRunning(activity.tools, status, hasEnded)
  useEffect(() => {
    if (activity.startedAt === undefined || !isRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activity.startedAt, isRunning])

  const durationMs =
    activity.startedAt === undefined || (!hasEnded && !isRunning)
      ? undefined
      : Math.max(0, (activity.endedAt ?? now) - activity.startedAt)
  const summary = getToolActivitySummary(
    activity.tools,
    status,
    activity.hasError,
    durationMs,
    hasEnded,
  )
  const StatusIcon = ACTIVITY_ICONS[summary.state]
  const parts = activity.parts ?? [
    ...(activity.reasoning
      ? [
          {
            reasoning: activity.reasoning,
            type: MESSAGE_PART_TYPE.REASONING,
          },
        ]
      : []),
    ...(activity.text ? [{ text: activity.text, type: 'text' as const }] : []),
    ...activity.tools.map((tool) => ({
      tool,
      type: MESSAGE_PART_TYPE.TOOL,
    })),
  ]
  const displayParts = groupConsecutiveToolParts(parts)

  return (
    <Collapsible
      className="group/tool-activity w-full border-b border-divider pb-3"
      defaultOpen={false}
    >
      <CollapsibleTrigger className="group/trigger flex max-w-full min-w-0 w-fit items-center gap-2 rounded-md py-1 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <StatusIcon
          aria-hidden="true"
          className={`size-4 shrink-0 ${
            summary.state === 'running'
              ? 'animate-spin motion-reduce:animate-none'
              : summary.state === TOOL_EXECUTION_STATE.FAILED
                ? 'text-danger'
                : ''
          }`}
        />
        <span className="min-w-0 truncate">
          {summary.state === 'running' ? (
            <TextShimmer>{summary.label}</TextShimmer>
          ) : (
            summary.label
          )}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 -rotate-90 transition-transform group-data-panel-open/trigger:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden pl-5 data-closed:animate-collapsible-up data-open:animate-collapsible-down motion-reduce:animate-none">
        <div className="flex flex-col gap-2 pt-1 pb-2">
          {displayParts.map((part, index) => {
            if (part.type === MESSAGE_PART_TYPE.REASONING) {
              return (
                <ReasoningPanel
                  key={`reasoning-${index}`}
                  reasoning={part.reasoning}
                  streaming={isRunning && index === displayParts.length - 1}
                />
              )
            }
            if (part.type === 'text') {
              return (
                <ChatMessagePrimitive.Content key={`text-${index}`}>
                  <MessageMarkdown>{part.text}</MessageMarkdown>
                </ChatMessagePrimitive.Content>
              )
            }
            if (part.type === 'tool-group') {
              return (
                <ToolCallGroup
                  key={`tool-group-${part.tools[0]?.toolCallId ?? index}`}
                  tools={part.tools}
                />
              )
            }
            return (
              <MessageTool
                key={part.tool.toolCallId ?? `${part.tool.toolName}-${index}`}
                tool={part.tool}
              />
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
