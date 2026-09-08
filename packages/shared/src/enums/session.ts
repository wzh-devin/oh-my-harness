export const SESSION_CUSTOM_TYPE = {
  AGENT_CONTEXT: 'agent/context',
  PLUGIN_SELECTION: 'plugins/selection',
  APPROVAL_REQUESTED: 'approval/requested',
  APPROVAL_RESOLVED: 'approval/resolved',
  CONTEXT_USAGE_SNAPSHOT: 'context_usage_snapshot',
  LLM_REQUEST_COMPLETED: 'llm/request-completed',
  LLM_REQUEST_STARTED: 'llm/request-started',
  LLM_REQUEST_HEADER: 'llm/request-header',
  RUN_STARTED: 'run/started',
  RUN_COMPLETED: 'run/completed',
  TURN_STARTED: 'turn/started',
  TURN_COMPLETED: 'turn/completed',
  RUN_POLICY: 'run/policy',
  SESSION_ARCHIVE_CHANGED: 'session/archive-changed',
  TODO_UPDATED: 'todo/updated',
  TOOL_EXECUTION_COMPLETED: 'tool/execution-completed',
  TOOL_EXECUTION_STARTED: 'tool/execution-started',
  USER_INPUT: 'user/input',
} as const
export type SessionCustomType =
  (typeof SESSION_CUSTOM_TYPE)[keyof typeof SESSION_CUSTOM_TYPE]

export const ATTACHMENT_KIND = {
  IMAGE: 'image',
  TEXT: 'text',
} as const
export type AttachmentKind =
  (typeof ATTACHMENT_KIND)[keyof typeof ATTACHMENT_KIND]

export const MESSAGE_PART_TYPE = {
  REASONING: 'reasoning',
  TEXT: 'text',
  TOOL: 'tool',
} as const

export const SESSION_TOOL_STATE = {
  INPUT_AVAILABLE: 'input-available',
  OUTPUT_AVAILABLE: 'output-available',
  OUTPUT_ERROR: 'output-error',
} as const
export type SessionToolState =
  (typeof SESSION_TOOL_STATE)[keyof typeof SESSION_TOOL_STATE]

export const AGENT_RUN_EVENT_TYPE = {
  TRAJECTORY_UPDATED: 'trajectory_updated',
  TRAJECTORY_DELTA: 'trajectory_delta',
  START: 'start',
  TRAJECTORY_CHANGED: 'trajectory_changed',
  TEXT_DELTA: 'text_delta',
  REASONING_DELTA: 'reasoning_delta',
  TODO_UPDATED: 'todo_updated',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  TOOL_APPROVAL_REQUIRED: 'tool_approval_required',
  USAGE: 'usage',
  DONE: 'done',
  ERROR: 'error',
} as const
export type AgentRunEventType =
  (typeof AGENT_RUN_EVENT_TYPE)[keyof typeof AGENT_RUN_EVENT_TYPE]

export const AGENT_RUN_STOP_REASON = {
  DEFERRED: 'deferred',
  LENGTH: 'length',
  STOP: 'stop',
  TOOL_USE: 'toolUse',
} as const
export type AgentRunStopReason =
  (typeof AGENT_RUN_STOP_REASON)[keyof typeof AGENT_RUN_STOP_REASON]

export const TRAJECTORY_STREAM_BLOCK = {
  TEXT: 'text',
  THINKING: 'thinking',
} as const
export type TrajectoryStreamBlock =
  (typeof TRAJECTORY_STREAM_BLOCK)[keyof typeof TRAJECTORY_STREAM_BLOCK]

export const AGENT_TRAJECTORY_LANE = {
  INPUT: 'input',
  MODEL: 'model',
  TOOLS: 'tools',
} as const
export type AgentTrajectoryLane =
  (typeof AGENT_TRAJECTORY_LANE)[keyof typeof AGENT_TRAJECTORY_LANE]

export const AGENT_TRAJECTORY_RECORD_KIND = {
  ASSISTANT: 'assistant',
  CONTEXT: 'context',
  REQUEST: 'request',
  SYSTEM: 'system',
  TOOL: 'tool',
  USER: 'user',
} as const
export type AgentTrajectoryRecordKind =
  (typeof AGENT_TRAJECTORY_RECORD_KIND)[keyof typeof AGENT_TRAJECTORY_RECORD_KIND]

export const AGENT_TRAJECTORY_STATUS = {
  ABORTED: 'aborted',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  RUNNING: 'running',
} as const
export type AgentTrajectoryStatus =
  (typeof AGENT_TRAJECTORY_STATUS)[keyof typeof AGENT_TRAJECTORY_STATUS]
