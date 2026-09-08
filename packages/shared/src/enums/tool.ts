export const BUILTIN_TOOL_NAME = {
  READ: 'read',
  WRITE: 'write',
  EDIT: 'edit',
  BASH: 'bash',
  LOAD_SKILL_RESOURCE: 'load_skill_resource',
  VIEW_ATTACHMENT: 'view_attachment',
  TODO_WRITE: 'todo_write',
} as const
export type BuiltinToolName =
  (typeof BUILTIN_TOOL_NAME)[keyof typeof BUILTIN_TOOL_NAME]

export const TODO_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const
export type TodoStatus = (typeof TODO_STATUS)[keyof typeof TODO_STATUS]

export const TOOL_ACTIVITY_KIND = {
  COMMAND: 'command',
  EDIT: 'edit',
  MCP: 'mcp',
  READ: 'read',
  SKILL: 'skill',
  TOOL: 'tool',
} as const
export type ToolActivityKind =
  (typeof TOOL_ACTIVITY_KIND)[keyof typeof TOOL_ACTIVITY_KIND]

export const TOOL_EXECUTION_STATE = {
  COMPLETE: 'complete',
  FAILED: 'failed',
  RUNNING: 'running',
} as const
export type ToolExecutionState =
  (typeof TOOL_EXECUTION_STATE)[keyof typeof TOOL_EXECUTION_STATE]
