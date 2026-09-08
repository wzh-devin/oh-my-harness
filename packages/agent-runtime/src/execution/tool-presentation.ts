import {
  POLICY_TOOL,
  TOOL_EFFECT,
  type PendingToolApproval,
} from '@oh-my-harness/agent-policy/contracts'
import {
  BUILTIN_TOOL_NAME,
  type BuiltinToolName,
} from '@oh-my-harness/agent-tools'
import {
  AGENT_RUN_EVENT_TYPE,
  TOOL_ACTIVITY_KIND,
  type ToolActivityKind,
} from '@oh-my-harness/shared'

const toolActivityKindMap = {
  [BUILTIN_TOOL_NAME.READ]: TOOL_ACTIVITY_KIND.READ,
  [BUILTIN_TOOL_NAME.WRITE]: TOOL_ACTIVITY_KIND.EDIT,
  [BUILTIN_TOOL_NAME.EDIT]: TOOL_ACTIVITY_KIND.EDIT,
  [BUILTIN_TOOL_NAME.BASH]: TOOL_ACTIVITY_KIND.COMMAND,
  [BUILTIN_TOOL_NAME.LOAD_SKILL_RESOURCE]: TOOL_ACTIVITY_KIND.SKILL,
  [BUILTIN_TOOL_NAME.VIEW_ATTACHMENT]: TOOL_ACTIVITY_KIND.READ,
  [BUILTIN_TOOL_NAME.TODO_WRITE]: TOOL_ACTIVITY_KIND.TOOL,
} as const satisfies Record<BuiltinToolName, string>
export type { ToolActivityKind }

/** 历史与实时共用分类；未知动态工具只降级展示，不产生执行授权。 */
export const getToolActivityKind = (name: string): ToolActivityKind =>
  Object.hasOwn(toolActivityKindMap, name)
    ? toolActivityKindMap[name as BuiltinToolName]
    : TOOL_ACTIVITY_KIND.TOOL

/** 从服务端原始审批生成实时与恢复共用的安全视图，不携带权限状态。 */
export const toToolApprovalEvent = (approval: PendingToolApproval) => {
  const common = {
    approvalId: approval.approvalId,
    toolCallId: approval.toolCallId,
    type: AGENT_RUN_EVENT_TYPE.TOOL_APPROVAL_REQUIRED,
  }
  if (approval.effect === TOOL_EFFECT.MCP)
    return {
      ...common,
      kind: TOOL_ACTIVITY_KIND.MCP,
      input: {
        connectionId: approval.connectionId,
        tool: approval.remoteToolName,
        arguments: approval.input,
      },
      title: `允许调用 MCP 工具 ${approval.remoteToolName} 吗？`,
      toolName: POLICY_TOOL.MCP.toolName,
    }
  if (approval.effect === TOOL_EFFECT.EXECUTE)
    return {
      ...common,
      kind: TOOL_ACTIVITY_KIND.COMMAND,
      input: { command: approval.command },
      title: '允许 AI 助手运行这条命令吗？',
      toolName: POLICY_TOOL.BASH.toolName,
    }
  if (approval.effect === TOOL_EFFECT.READ)
    return {
      ...common,
      kind: TOOL_ACTIVITY_KIND.READ,
      path: approval.path,
      title: `允许 AI 助手读取 ${approval.path} 吗？`,
      toolName: approval.toolName,
    }
  return {
    ...common,
    kind: TOOL_ACTIVITY_KIND.EDIT,
    path: approval.path,
    title: `允许 AI 助手修改 ${approval.path} 吗？`,
    toolName: approval.toolName,
  }
}
export type ToolApprovalEvent = ReturnType<typeof toToolApprovalEvent>
