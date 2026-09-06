import type { ToolCallMessagePartStatus } from '@assistant-ui/react'
import type {
  ChatAssistantStatus,
  ChatMessageActivityPart,
  ChatMessageTool,
} from '../../data/chat-types.ts'

export type ToolActivityDisplayPart =
  | Exclude<ChatMessageActivityPart, { type: 'tool' }>
  | { tool: ChatMessageTool; type: 'tool' }
  | { tools: readonly ChatMessageTool[]; type: 'tool-group' }

export interface ToolActivitySummary {
  label: string
  state: 'complete' | 'failed' | 'running'
}

interface ToolApprovalPresentation {
  label: string
  question: string
  target?: string
}

export interface ToolFilePresentation {
  label: string
  path: string
}

export const isToolActivityRunning = (
  tools: readonly ChatMessageTool[],
  status?: ChatAssistantStatus,
  hasEnded = false,
) =>
  !hasEnded &&
  (status === 'streaming' ||
    tools.some(
      (tool) =>
        tool.state === 'input-streaming' ||
        tool.state === 'input-available' ||
        tool.state === 'requires-action',
    ))

/** 将 Agent Run 毫秒耗时格式化为紧凑中文。 */
export const formatToolActivityDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [
    hours ? `${hours}小时` : '',
    minutes ? `${minutes}分钟` : '',
    `${seconds}秒`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** 汇总折叠工具活动的运行、完成和失败状态。 */
export const getToolActivitySummary = (
  tools: readonly ChatMessageTool[],
  status?: ChatAssistantStatus,
  hasRunError = false,
  durationMs?: number,
  hasEnded = false,
): ToolActivitySummary => {
  const durationLabel =
    durationMs === undefined
      ? undefined
      : `用时 ${formatToolActivityDuration(durationMs)}`
  if (hasRunError) {
    return {
      label: durationLabel ? `运行失败 · ${durationLabel}` : '工具运行失败',
      state: 'failed',
    }
  }

  const isRunning = isToolActivityRunning(tools, status, hasEnded)
  if (isRunning) {
    return { label: durationLabel ?? '正在使用工具', state: 'running' }
  }

  return {
    label: durationLabel ?? '工具活动',
    state: 'complete',
  }
}

/** 以文本和推理为边界，把两个以上连续工具合并为展示子组。 */
export const groupConsecutiveToolParts = (
  parts: readonly ChatMessageActivityPart[],
): ToolActivityDisplayPart[] => {
  const groupedParts: ToolActivityDisplayPart[] = []
  let tools: ChatMessageTool[] = []
  const flushTools = () => {
    if (tools.length === 1) groupedParts.push({ tool: tools[0]!, type: 'tool' })
    else if (tools.length > 1) groupedParts.push({ tools, type: 'tool-group' })
    tools = []
  }

  for (const part of parts) {
    if (part.type === 'tool') tools.push(part.tool)
    else {
      flushTools()
      groupedParts.push(part)
    }
  }
  flushTools()
  return groupedParts
}

const TOOL_GROUP_LABELS: Record<
  NonNullable<ChatMessageTool['kind']>,
  string
> = {
  browser: '浏览了网页',
  command: '运行了命令',
  edit: '编辑了文件',
  read: '读取文件',
  search: '进行了搜索',
  skill: '加载了工具',
  tool: '调用了工具',
}

/** 按首次出现顺序汇总工具类别，生成 Codex 风格子组标题。 */
export const getToolGroupLabel = (tools: readonly ChatMessageTool[]) => {
  const kinds = [
    ...new Set(tools.map((tool) => tool.kind ?? ('tool' as const))),
  ]
  const label = kinds.map((kind) => TOOL_GROUP_LABELS[kind]).join('')
  return kinds[0] === 'read' ? `已${label}` : label
}

/** 将现有工具状态投影到 assistant-ui ToolFallback 状态。 */
export const getToolStatus = (
  tool: ChatMessageTool,
): ToolCallMessagePartStatus => {
  if (tool.state === 'output-available') return { type: 'complete' }
  if (tool.state === 'output-error') {
    return {
      error: tool.errorText ?? 'Tool call failed',
      reason: 'error',
      type: 'incomplete',
    }
  }
  return { type: 'running' }
}

/** 将结构化工具输入转换为 ToolFallback 可显示的参数文本。 */
export const getToolArgsText = (tool: ChatMessageTool) => {
  if (tool.argsText !== undefined) return tool.argsText
  if (tool.input === undefined) return undefined
  try {
    return JSON.stringify(tool.input, null, 2)
  } catch {
    return String(tool.input)
  }
}

/** 直接使用结构化 Bash outcome 展示退出状态，不从输出文本反推。 */
export const getBashOutcomeLabel = (tool: ChatMessageTool) => {
  const outcome = tool.kind === 'command' ? tool.outcome : undefined
  if (!outcome) return
  if (outcome.outputExceeded) return '输出超过 256 KiB'
  if (outcome.timedOut) return '执行超时'
  if (outcome.signal) return `信号 ${outcome.signal}`
  return `退出码 ${outcome.exitCode ?? '未知'}`
}

/** 从未知工具输入中读取一个字段，不信任跨边界参数形状。 */
const inputField = (input: unknown, key: string) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  return (input as Record<string, unknown>)[key]
}

/** 只把成功文件工具的结构化相对路径投影为可打开文件。 */
export const getToolFilePresentation = (
  tool: ChatMessageTool,
): ToolFilePresentation | undefined => {
  if (
    tool.state !== 'output-available' ||
    (tool.kind !== 'read' && tool.kind !== 'edit')
  ) {
    return
  }
  const path = inputField(tool.input, 'path')
  if (
    typeof path !== 'string' ||
    !path.trim() ||
    path === '[blocked path]' ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split(/[\\/]/u).includes('..')
  ) {
    return
  }
  return { label: tool.kind === 'read' ? '已读取' : '已编辑', path }
}

/** 将待审批工具转换为用户可直接核对的操作、问题与目标。 */
export const getToolApprovalPresentation = (
  tool: ChatMessageTool,
): ToolApprovalPresentation => {
  if (tool.kind === 'command') {
    const command = inputField(tool.input, 'command')

    return {
      label: '运行命令',
      question: '是否允许 oh-my-harness 运行以下命令？',
      target:
        typeof command === 'string' && command
          ? command
          : tool.approval?.description,
    }
  }

  if (tool.kind === 'edit' || tool.kind === 'read') {
    const path = inputField(tool.input, 'path')
    const isRead = tool.kind === 'read'
    return {
      label: isRead ? '读取文件' : '编辑文件',
      question: `是否允许 oh-my-harness ${isRead ? '读取' : '编辑'}以下文件？`,
      target: typeof path === 'string' ? path : tool.approval?.description,
    }
  }

  return {
    label: '权限',
    question: tool.approval?.title ?? `允许 AI 助手使用 ${tool.toolName} 吗？`,
    target: tool.approval?.description,
  }
}
