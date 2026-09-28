import {
  BUILTIN_TOOL_NAME,
  MESSAGE_PART_TYPE,
  SESSION_TOOL_STATE,
  TOOL_EXECUTION_STATE,
} from '@oh-my-harness/shared'
import type {
  ChatMessageActivityPart,
  ChatMessageTool,
  ChatThread,
} from '../types/chat-types.ts'
import type { ToolExecutionVo } from '../session/types/index.ts'

export const EXECUTION_STATE_LABEL: Record<ToolExecutionVo['state'], string> = {
  [TOOL_EXECUTION_STATE.RUNNING]: '运行中',
  [TOOL_EXECUTION_STATE.STOPPING]: '停止中',
  [TOOL_EXECUTION_STATE.STOPPED]: '已停止',
  [TOOL_EXECUTION_STATE.SUCCEEDED]: '已结束',
  [TOOL_EXECUTION_STATE.FAILED]: '失败',
  [TOOL_EXECUTION_STATE.INTERRUPTED]: '已中断',
}

/** 展示时省略与实际目录完全一致的 cd 前缀；不解析或改写其他 Shell 命令。 */
export const getServiceCommandLabel = (command: string, cwd: string) => {
  const prefix = [cwd, `'${cwd}'`, `"${cwd}"`]
    .map((path) => `cd ${path} && `)
    .find((value) => command.startsWith(value))
  return prefix ? command.slice(prefix.length).trim() || command : command
}

/** 服务由启动时的明确标记决定，重启链只保留最新实例，普通慢工具不进入简介。 */
export const selectServices = (executionList: readonly ToolExecutionVo[]) => {
  const serviceList = executionList.filter(
    (execution) =>
      execution.toolName === BUILTIN_TOOL_NAME.BASH && execution.service,
  )
  const replacedIdSet = new Set(
    serviceList.map((execution) => execution.previousExecutionId),
  )
  return serviceList
    .filter(
      (execution) =>
        !replacedIdSet.has(execution.executionId) &&
        execution.service?.removedAt === undefined,
    )
    .sort((left, right) => left.startedAt - right.startedAt)
}

/** 将后台执行事实投影到已有消息，保留草稿、消息内容与其他工具，不依赖控制台显隐。 */
export const projectToolExecutions = (
  thread: ChatThread,
  executionList: readonly ToolExecutionVo[],
): ChatThread => {
  const executionMap = new Map(
    executionList
      .filter(
        (execution) =>
          execution.sessionId === thread.id && execution.background,
      )
      .map((execution) => [execution.toolCallId, execution]),
  )
  if (!executionMap.size) return thread
  const projectTool = (tool: ChatMessageTool): ChatMessageTool => {
    const execution = executionMap.get(tool.toolCallId ?? '')
    if (!execution) return tool
    let state: ChatMessageTool['state'] = SESSION_TOOL_STATE.OUTPUT_ERROR
    if (
      execution.state === TOOL_EXECUTION_STATE.RUNNING ||
      execution.state === TOOL_EXECUTION_STATE.STOPPING
    )
      state = SESSION_TOOL_STATE.INPUT_AVAILABLE
    else if (execution.state === TOOL_EXECUTION_STATE.SUCCEEDED)
      state = SESSION_TOOL_STATE.OUTPUT_AVAILABLE
    return {
      ...tool,
      background: execution.background,
      executionId: execution.executionId,
      state,
      output: execution.output ?? tool.output,
      errorText:
        execution.error ??
        (state === SESSION_TOOL_STATE.OUTPUT_ERROR
          ? EXECUTION_STATE_LABEL[execution.state]
          : undefined),
    }
  }
  const projectParts = (parts?: readonly ChatMessageActivityPart[]) =>
    parts?.map((part) =>
      part.type === MESSAGE_PART_TYPE.TOOL
        ? { ...part, tool: projectTool(part.tool) }
        : part,
    )
  return {
    ...thread,
    messages: thread.messages.map((message) => ({
      ...message,
      tools: message.tools?.map(projectTool),
      parts: projectParts(message.parts),
      ...(message.activity
        ? {
            activity: {
              ...message.activity,
              tools: message.activity.tools.map(projectTool),
              parts: projectParts(message.activity.parts),
            },
          }
        : {}),
    })),
  }
}
