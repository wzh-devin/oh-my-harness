import { POLICY_TOOL } from '@oh-my-harness/agent-policy/contracts'

export const BUILTIN_TOOL_NAME = {
  read: POLICY_TOOL.read.toolName,
  write: POLICY_TOOL.write.toolName,
  edit: POLICY_TOOL.edit.toolName,
  bash: POLICY_TOOL.bash.toolName,
  loadSkillResource: 'load_skill_resource',
  viewAttachment: 'view_attachment',
  todoWrite: 'todo_write',
} as const
export type BuiltinToolName =
  (typeof BUILTIN_TOOL_NAME)[keyof typeof BUILTIN_TOOL_NAME]
