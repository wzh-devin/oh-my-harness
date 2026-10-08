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
import type {
  ChatMessageImage,
  ChatMessageTool,
} from '../../types/chat-types.ts'
import {
  getWorkspaceImageReference,
  useChatWorkspace,
} from '../../workspace/index.ts'
import {
  getBashOutcomeLabel,
  getToolArgsText,
  getToolFilePresentation,
  getToolStatus,
} from '../utils/tool-display.ts'
import { WorkspaceImagePreview } from './WorkspaceImagePreview.tsx'

const TOOL_ICONS: Record<NonNullable<ChatMessageTool['kind']>, ElementType> = {
  browser: Globe2Icon,
  command: TerminalIcon,
  edit: PencilIcon,
  read: FileTextIcon,
  search: SearchIcon,
  skill: SparklesIcon,
  tool: WrenchIcon,
}

const SAFE_TOOL_IMAGE_SOURCE =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,[A-Za-z0-9+/]+=*$/iu

function ToolImages({ images }: { images?: readonly ChatMessageImage[] }) {
  const safeImages = images?.filter((image) =>
    SAFE_TOOL_IMAGE_SOURCE.test(image.src),
  )
  if (!safeImages?.length) return null
  return (
    <div className="flex flex-wrap gap-2 py-2">
      {safeImages.map((image, index) => (
        <img
          alt={image.alt || '工具返回的图片'}
          className="max-h-[512px] max-w-full rounded-xl bg-white object-contain p-2"
          decoding="async"
          key={`${image.src.slice(0, 48)}-${index}`}
          loading="lazy"
          src={image.src}
        />
      ))}
    </div>
  )
}

interface MessageToolProps {
  tool: ChatMessageTool
  workspaceId?: string | null
}

/** 展示普通工具调用或待审批工具状态。 */
export function MessageTool({ tool, workspaceId }: MessageToolProps) {
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
  const imageReference =
    workspaceId && file ? getWorkspaceImageReference(file.path) : undefined
  const outcomeLabel = getBashOutcomeLabel(tool)
  if (file && onFileOpen) {
    const FileIcon = TOOL_ICONS[tool.kind ?? 'tool']
    return (
      <div className="min-w-0 py-1">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
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
        <ToolImages images={tool.images} />
        {!tool.images?.length && imageReference && workspaceId ? (
          <WorkspaceImagePreview
            alt={`工作区图片：${imageReference.name}`}
            fallback={null}
            path={imageReference.path}
            workspaceId={workspaceId}
          />
        ) : null}
      </div>
    )
  }

  return (
    <ToolFallbackRoot
      defaultOpen={status.type === 'running' && !tool.background}
    >
      <ToolFallbackTrigger
        background={tool.background}
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
        <ToolImages images={tool.images} />
        {!tool.images?.length && imageReference && workspaceId ? (
          <WorkspaceImagePreview
            alt={`工作区图片：${imageReference.name}`}
            fallback={null}
            path={imageReference.path}
            workspaceId={workspaceId}
          />
        ) : null}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}
