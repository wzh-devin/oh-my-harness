import type { ToolCallMessagePartStatus } from '@assistant-ui/react'
import {
  CHAT_ASSISTANT_STATUS,
  CHAT_TOOL_KIND,
  MESSAGE_PART_TYPE,
  SESSION_TOOL_STATE,
  TOOL_EXECUTION_STATE,
  type ToolExecutionState,
} from '@oh-my-harness/shared'
import type {
  ChatAssistantStatus,
  ChatMessageActivityPart,
  ChatMessageTool,
} from '../../data/chat-types.ts'

export type ToolActivityDisplayPart =
  | Exclude<ChatMessageActivityPart, { type: typeof MESSAGE_PART_TYPE.TOOL }>
  | { tool: ChatMessageTool; type: typeof MESSAGE_PART_TYPE.TOOL }
  | { tools: readonly ChatMessageTool[]; type: 'tool-group' }

export interface ToolActivitySummary {
  label: string
  state: ToolExecutionState
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
  (status === CHAT_ASSISTANT_STATUS.STREAMING ||
    tools.some(
      (tool) =>
        tool.state === 'input-streaming' ||
        tool.state === SESSION_TOOL_STATE.INPUT_AVAILABLE ||
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
      state: TOOL_EXECUTION_STATE.FAILED,
    }
  }

  const isRunning = isToolActivityRunning(tools, status, hasEnded)
  if (isRunning) {
    return {
      label: durationLabel ?? '正在使用工具',
      state: TOOL_EXECUTION_STATE.RUNNING,
    }
  }

  return {
    label: durationLabel ?? '工具活动',
    state: TOOL_EXECUTION_STATE.COMPLETE,
  }
}

/** 以文本和推理为边界，把两个以上连续工具合并为展示子组。 */
export const groupConsecutiveToolParts = (
  parts: readonly ChatMessageActivityPart[],
): ToolActivityDisplayPart[] => {
  const groupedParts: ToolActivityDisplayPart[] = []
  let tools: ChatMessageTool[] = []
  const flushTools = () => {
    if (tools.length === 1)
      groupedParts.push({ tool: tools[0]!, type: MESSAGE_PART_TYPE.TOOL })
    else if (tools.length > 1) groupedParts.push({ tools, type: 'tool-group' })
    tools = []
  }

  for (const part of parts) {
    if (part.type === MESSAGE_PART_TYPE.TOOL) tools.push(part.tool)
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
  [CHAT_TOOL_KIND.BROWSER]: '浏览了网页',
  [CHAT_TOOL_KIND.COMMAND]: '运行了命令',
  [CHAT_TOOL_KIND.EDIT]: '编辑了文件',
  [CHAT_TOOL_KIND.READ]: '读取文件',
  [CHAT_TOOL_KIND.SEARCH]: '进行了搜索',
  [CHAT_TOOL_KIND.SKILL]: '加载了工具',
  [CHAT_TOOL_KIND.TOOL]: '调用了工具',
}

/** 按首次出现顺序汇总工具类别，生成 Codex 风格子组标题。 */
export const getToolGroupLabel = (tools: readonly ChatMessageTool[]) => {
  const kinds = [
    ...new Set(tools.map((tool) => tool.kind ?? CHAT_TOOL_KIND.TOOL)),
  ]
  const label = kinds.map((kind) => TOOL_GROUP_LABELS[kind]).join('')
  return kinds[0] === CHAT_TOOL_KIND.READ ? `已${label}` : label
}

/** 将现有工具状态投影到 assistant-ui ToolFallback 状态。 */
export const getToolStatus = (
  tool: ChatMessageTool,
): ToolCallMessagePartStatus => {
  if (tool.state === SESSION_TOOL_STATE.OUTPUT_AVAILABLE)
    return { type: 'complete' }
  if (tool.state === SESSION_TOOL_STATE.OUTPUT_ERROR) {
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
  const outcome =
    tool.kind === CHAT_TOOL_KIND.COMMAND ? tool.outcome : undefined
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
    tool.state !== SESSION_TOOL_STATE.OUTPUT_AVAILABLE ||
    (tool.kind !== CHAT_TOOL_KIND.READ && tool.kind !== CHAT_TOOL_KIND.EDIT)
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
  return {
    label: tool.kind === CHAT_TOOL_KIND.READ ? '已读取' : '已编辑',
    path,
  }
}

/** 将待审批工具转换为用户可直接核对的操作、问题与目标。 */
export const getToolApprovalPresentation = (
  tool: ChatMessageTool,
): ToolApprovalPresentation => {
  if (tool.kind === CHAT_TOOL_KIND.COMMAND) {
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

  if (tool.kind === CHAT_TOOL_KIND.EDIT || tool.kind === CHAT_TOOL_KIND.READ) {
    const path = inputField(tool.input, 'path')
    const isRead = tool.kind === CHAT_TOOL_KIND.READ
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
