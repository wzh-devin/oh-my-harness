export const TOOL_PERMISSION = {
  READ_ONLY: 'read-only',
  WORKSPACE_WRITE: 'workspace-write',
  FULL_ACCESS: 'full-access',
} as const
export type ToolPermission =
  (typeof TOOL_PERMISSION)[keyof typeof TOOL_PERMISSION]

export const TOOL_EFFECT = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
  MCP: 'mcp',
} as const
export type ToolEffect = (typeof TOOL_EFFECT)[keyof typeof TOOL_EFFECT]
export type FileToolEffect = typeof TOOL_EFFECT.READ | typeof TOOL_EFFECT.WRITE

export const FILE_SCOPE = {
  WORKSPACE: 'workspace',
  EXTERNAL: 'external',
} as const
export type FileScope = (typeof FILE_SCOPE)[keyof typeof FILE_SCOPE]

export const POLICY_DECISION = {
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require-approval',
} as const
export type PolicyDecision =
  (typeof POLICY_DECISION)[keyof typeof POLICY_DECISION]

export const APPROVAL_DECISION = {
  APPROVE_ONCE: 'approve-once',
  REJECT: 'reject',
} as const
export type ApprovalDecision =
  (typeof APPROVAL_DECISION)[keyof typeof APPROVAL_DECISION]

export const APPROVAL_RESOLUTION_REASON = {
  ABORTED: 'aborted',
  SERVER_CLOSED: 'server-closed',
  USER: 'user',
} as const
export type ApprovalResolutionReason =
  (typeof APPROVAL_RESOLUTION_REASON)[keyof typeof APPROVAL_RESOLUTION_REASON]

export const TOOL_POLICY_ERROR_CODE = {
  APPROVAL_ALREADY_RESOLVED: 'APPROVAL_ALREADY_RESOLVED',
  APPROVAL_NOT_FOUND: 'APPROVAL_NOT_FOUND',
  TOOL_APPROVAL_AUDIT_FAILED: 'TOOL_APPROVAL_AUDIT_FAILED',
  TOOL_APPROVAL_REJECTED: 'TOOL_APPROVAL_REJECTED',
  TOOL_PERMISSION_DENIED: 'TOOL_PERMISSION_DENIED',
} as const
export type ToolPolicyErrorCode =
  (typeof TOOL_POLICY_ERROR_CODE)[keyof typeof TOOL_POLICY_ERROR_CODE]
