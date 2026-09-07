export const TOOL_PERMISSION = {
  readOnly: 'read-only',
  workspaceWrite: 'workspace-write',
  fullAccess: 'full-access',
} as const
export const TOOL_PERMISSIONS: readonly ToolPermission[] =
  Object.values(TOOL_PERMISSION)
export type ToolPermission =
  (typeof TOOL_PERMISSION)[keyof typeof TOOL_PERMISSION]

export const TOOL_EFFECT = {
  read: 'read',
  write: 'write',
  execute: 'execute',
  mcp: 'mcp',
} as const
export type ToolEffect = (typeof TOOL_EFFECT)[keyof typeof TOOL_EFFECT]
export type FileToolEffect = typeof TOOL_EFFECT.read | typeof TOOL_EFFECT.write

export const FILE_SCOPE = {
  workspace: 'workspace',
  external: 'external',
} as const
export type FileScope = (typeof FILE_SCOPE)[keyof typeof FILE_SCOPE]

export const POLICY_DECISION = {
  allow: 'allow',
  deny: 'deny',
  requireApproval: 'require-approval',
} as const
export type PolicyDecision =
  (typeof POLICY_DECISION)[keyof typeof POLICY_DECISION]

export const APPROVAL_DECISION = {
  approveOnce: 'approve-once',
  reject: 'reject',
} as const
export type ApprovalDecision =
  (typeof APPROVAL_DECISION)[keyof typeof APPROVAL_DECISION]

export const POLICY_TOOL = {
  read: { toolName: 'read', effect: TOOL_EFFECT.read },
  write: { toolName: 'write', effect: TOOL_EFFECT.write },
  edit: { toolName: 'edit', effect: TOOL_EFFECT.write },
  bash: { toolName: 'bash', effect: TOOL_EFFECT.execute },
  mcp: { toolName: 'mcp', effect: TOOL_EFFECT.mcp },
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
  return tool?.effect === TOOL_EFFECT.read || tool?.effect === TOOL_EFFECT.write
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
  typeof POLICY_TOOL.bash & {
    command: string
  }
export type McpToolAuthorizationRequest = ToolAuthorizationBase &
  typeof POLICY_TOOL.mcp & {
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
  reason: 'aborted' | 'server-closed' | 'user'
}
