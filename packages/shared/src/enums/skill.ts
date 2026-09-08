export const SKILL_IMPORT_STATUS = {
  FETCHING: 'fetching',
  READY: 'ready',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type SkillImportStatus =
  (typeof SKILL_IMPORT_STATUS)[keyof typeof SKILL_IMPORT_STATUS]

export const SKILL_IMPORT_CANDIDATE_STATUS = {
  AVAILABLE: 'available',
  ALREADY_INSTALLED: 'already-installed',
  CONFLICT: 'conflict',
  INVALID: 'invalid',
} as const
export type SkillImportCandidateStatus =
  (typeof SKILL_IMPORT_CANDIDATE_STATUS)[keyof typeof SKILL_IMPORT_CANDIDATE_STATUS]

export const SKILL_INSTALL_STATUS = {
  INSTALLED: 'installed',
  ALREADY_INSTALLED: SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED,
} as const
export type SkillInstallStatus =
  (typeof SKILL_INSTALL_STATUS)[keyof typeof SKILL_INSTALL_STATUS]

export const AGENT_CAPABILITY_SOURCE = {
  BUILTIN: 'builtin',
  PROJECT: 'project',
  USER: 'user',
  PLUGIN: 'plugin',
} as const
export type AgentCapabilitySource =
  (typeof AGENT_CAPABILITY_SOURCE)[keyof typeof AGENT_CAPABILITY_SOURCE]
export type AgentCommandSource = AgentCapabilitySource
export type AgentSkillSource =
  typeof AGENT_CAPABILITY_SOURCE.USER | typeof AGENT_CAPABILITY_SOURCE.PLUGIN
export type CapabilityScope =
  typeof AGENT_CAPABILITY_SOURCE.PROJECT | typeof AGENT_CAPABILITY_SOURCE.USER

export const CAPABILITY_KIND = {
  COMMAND: 'command',
  MCP: 'mcp',
  PLUGIN: 'plugin',
  SKILL: 'skill',
} as const
export type CapabilityKind =
  (typeof CAPABILITY_KIND)[keyof typeof CAPABILITY_KIND]
export type AgentContextKind = Exclude<
  CapabilityKind,
  typeof CAPABILITY_KIND.MCP
>
