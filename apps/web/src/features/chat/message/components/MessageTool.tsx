import type { ElementType } from 'react'
import {
  FileTextIcon,
  Globe2Icon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from '../../../../components/assistant-ui/index.ts'
import type { ChatMessageTool } from '../../types/chat-types.ts'
import { useChatWorkspace } from '../../workspace/index.ts'
import {
  getBashOutcomeLabel,
  getToolArgsText,
  getToolFilePresentation,
  getToolStatus,
} from '../utils/tool-display.ts'

const TOOL_ICONS: Record<NonNullable<ChatMessageTool['kind']>, ElementType> = {
  browser: Globe2Icon,
  command: TerminalIcon,
  edit: PencilIcon,
  read: FileTextIcon,
  search: SearchIcon,
  skill: SparklesIcon,
  tool: WrenchIcon,
}

interface MessageToolProps {
  tool: ChatMessageTool
}

/** 展示普通工具调用或待审批工具状态。 */
export function MessageTool({ tool }: MessageToolProps) {
  const { onFileOpen } = useChatWorkspace()
  if (tool.state === 'requires-action') {
    return (
      <div className="flex min-h-7 items-center gap-2 text-sm text-muted">
        <WrenchIcon className="size-4 shrink-0" />
        <span>等待审批 · {tool.label ?? tool.toolName}</span>
      </div>
    )
  }

  const status = getToolStatus(tool)
  const file = getToolFilePresentation(tool)
  const outcomeLabel = getBashOutcomeLabel(tool)
  if (file && onFileOpen) {
    const FileIcon = TOOL_ICONS[tool.kind ?? 'tool']
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 text-sm text-muted">
        <FileIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="shrink-0">{file.label}</span>
        <button
          aria-label={`打开文件 ${file.path}`}
          className="-mx-1 min-w-0 cursor-pointer rounded px-1 break-all text-left text-foreground underline decoration-divider underline-offset-4 transition-colors hover:bg-surface-tertiary hover:decoration-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={file.path}
          type="button"
          onClick={() => onFileOpen(file.path)}
        >
          {file.path}
        </button>
      </div>
    )
  }

  return (
    <ToolFallbackRoot defaultOpen={status.type === 'running'}>
      <ToolFallbackTrigger
        icon={TOOL_ICONS[tool.kind ?? 'tool']}
        label={tool.label}
        status={status}
        toolName={tool.toolName}
      />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={getToolArgsText(tool)} />
        {outcomeLabel ? (
          <div className="px-3 pb-2 text-xs text-muted">{outcomeLabel}</div>
        ) : null}
        <ToolFallbackResult result={tool.output} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}
