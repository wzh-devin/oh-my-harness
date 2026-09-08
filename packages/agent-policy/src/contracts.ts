import {
  APPROVAL_DECISION,
  BUILTIN_TOOL_NAME,
  FILE_SCOPE,
  POLICY_DECISION,
  TOOL_EFFECT,
  TOOL_PERMISSION,
  type ApprovalDecision,
  type ApprovalResolutionReason,
  type FileScope,
  type FileToolEffect,
  type PolicyDecision,
  type ToolEffect,
  type ToolPermission,
} from '@oh-my-harness/shared'

export {
  APPROVAL_DECISION,
  FILE_SCOPE,
  POLICY_DECISION,
  TOOL_EFFECT,
  TOOL_PERMISSION,
}
export type {
  ApprovalDecision,
  FileScope,
  FileToolEffect,
  PolicyDecision,
  ToolEffect,
  ToolPermission,
}

export const TOOL_PERMISSIONS: readonly ToolPermission[] =
  Object.values(TOOL_PERMISSION)

export const POLICY_TOOL = {
  READ: { toolName: BUILTIN_TOOL_NAME.READ, effect: TOOL_EFFECT.READ },
  WRITE: { toolName: BUILTIN_TOOL_NAME.WRITE, effect: TOOL_EFFECT.WRITE },
  EDIT: { toolName: BUILTIN_TOOL_NAME.EDIT, effect: TOOL_EFFECT.WRITE },
  BASH: { toolName: BUILTIN_TOOL_NAME.BASH, effect: TOOL_EFFECT.EXECUTE },
  MCP: { toolName: 'mcp', effect: TOOL_EFFECT.MCP },
} as const
export type PolicyToolDefinition =
  (typeof POLICY_TOOL)[keyof typeof POLICY_TOOL]
export type FileToolDefinition = Extract<
  PolicyToolDefinition,
  { effect: FileToolEffect }
>
export type FileToolName = FileToolDefinition['toolName']
const policyTools = Object.values(POLICY_TOOL)
const approvalDecisions = Object.values(APPROVAL_DECISION)

/** 校验跨进程输入的权限值，未知模式不能扩大能力。 */
export const isToolPermission = (value: unknown): value is ToolPermission =>
  TOOL_PERMISSIONS.some((permission) => permission === value)

export const isApprovalDecision = (value: unknown): value is ApprovalDecision =>
  approvalDecisions.some((decision) => decision === value)

/** 只解析宿主支持的授权类别，不把 MCP 动态工具名当作授权。 */
export const getPolicyTool = (
  name: unknown,
): PolicyToolDefinition | undefined =>
  policyTools.find((tool) => tool.toolName === name)

/** 授权与执行共用文件工具描述，拒绝未知工具及非文件能力。 */
export const getFileTool = (name: unknown): FileToolDefinition | undefined => {
  const tool = getPolicyTool(name)
  return tool?.effect === TOOL_EFFECT.READ || tool?.effect === TOOL_EFFECT.WRITE
    ? tool
    : undefined
}

interface ToolAuthorizationBase {
  permission: ToolPermission
  runId: string
  sessionId: string
  toolCallId: string
}

export type FileToolAuthorizationRequest = ToolAuthorizationBase &
  FileToolDefinition & {
    path: string
    scope: FileScope
  }
export type BashToolAuthorizationRequest = ToolAuthorizationBase &
  typeof POLICY_TOOL.BASH & {
    command: string
  }
export type McpToolAuthorizationRequest = ToolAuthorizationBase &
  typeof POLICY_TOOL.MCP & {
    connectionId: string
    remoteToolName: string
    input: Record<string, unknown>
  }
export type ToolAuthorizationRequest =
  | FileToolAuthorizationRequest
  | BashToolAuthorizationRequest
  | McpToolAuthorizationRequest
export type PendingToolApproval = ToolAuthorizationRequest & {
  approvalId: string
}
export type ApprovalResolution = PendingToolApproval & {
  decision: ApprovalDecision
  reason: ApprovalResolutionReason
}
