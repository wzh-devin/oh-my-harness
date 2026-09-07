export { BUILTIN_TOOL_NAME } from './tool-names.ts'
export type { BuiltinToolName } from './tool-names.ts'
export { createWorkspaceTools } from './workspace/toolset.ts'
export {
  createSkillResourceTool,
  type SkillResourceRoot,
} from './skills/read-resource.ts'
export {
  createAttachmentTool,
  type AttachmentResource,
} from './tools/attachment.ts'
export { createBashTool, parseBashInput } from './tools/bash.ts'
export type { BashInput, BashOutcome } from './tools/bash.ts'
export {
  createTodoWriteTool,
  parseTodoWriteInput,
  type TodoItem,
  type TodoStatus,
} from './tools/todo.ts'
export { WorkspaceExecutionEnv } from './workspace/execution-env.ts'
export { createMcpTools } from './mcp/toolset.ts'
export {
  McpConnectionService,
  pluginConnectionTargets,
} from './mcp/auth/connection-service.ts'
export type {
  McpCredentialStore,
  McpCredentialRecord,
  McpConnectionSettings,
  McpConnectionTarget,
  McpConnectionStatus,
} from './mcp/auth/connection-service.ts'
