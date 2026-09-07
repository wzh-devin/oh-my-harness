import {
  POLICY_TOOL,
  TOOL_EFFECT,
  type PendingToolApproval,
} from '@oh-my-harness/agent-policy/contracts'
import {
  BUILTIN_TOOL_NAME,
  type BuiltinToolName,
} from '@oh-my-harness/agent-tools'

const toolActivityKindMap = {
  [BUILTIN_TOOL_NAME.read]: 'read',
  [BUILTIN_TOOL_NAME.write]: 'edit',
  [BUILTIN_TOOL_NAME.edit]: 'edit',
  [BUILTIN_TOOL_NAME.bash]: 'command',
  [BUILTIN_TOOL_NAME.loadSkillResource]: 'skill',
  [BUILTIN_TOOL_NAME.viewAttachment]: 'read',
  [BUILTIN_TOOL_NAME.todoWrite]: 'tool',
} as const satisfies Record<BuiltinToolName, string>
export type ToolActivityKind = (typeof toolActivityKindMap)[BuiltinToolName]

/** 历史与实时共用分类；未知动态工具只降级展示，不产生执行授权。 */
export const getToolActivityKind = (name: string): ToolActivityKind =>
  Object.hasOwn(toolActivityKindMap, name)
    ? toolActivityKindMap[name as BuiltinToolName]
    : 'tool'

/** 从服务端原始审批生成实时与恢复共用的安全视图，不携带权限状态。 */
export const toToolApprovalEvent = (approval: PendingToolApproval) => {
  const common = {
    approvalId: approval.approvalId,
    toolCallId: approval.toolCallId,
    type: 'tool_approval_required' as const,
  }
  if (approval.effect === TOOL_EFFECT.mcp)
    return {
      ...common,
      kind: 'mcp' as const,
      input: {
        connectionId: approval.connectionId,
        tool: approval.remoteToolName,
        arguments: approval.input,
      },
      title: `允许调用 MCP 工具 ${approval.remoteToolName} 吗？`,
      toolName: POLICY_TOOL.mcp.toolName,
    }
  if (approval.effect === TOOL_EFFECT.execute)
    return {
      ...common,
      kind: 'command' as const,
      input: { command: approval.command },
      title: '允许 AI 助手运行这条命令吗？',
      toolName: POLICY_TOOL.bash.toolName,
    }
  if (approval.effect === TOOL_EFFECT.read)
    return {
      ...common,
      kind: 'read' as const,
      path: approval.path,
      title: `允许 AI 助手读取 ${approval.path} 吗？`,
      toolName: approval.toolName,
    }
  return {
    ...common,
    kind: 'edit' as const,
    path: approval.path,
    title: `允许 AI 助手修改 ${approval.path} 吗？`,
    toolName: approval.toolName,
  }
}
export type ToolApprovalEvent = ReturnType<typeof toToolApprovalEvent>
