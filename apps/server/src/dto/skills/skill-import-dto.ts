import {
  type SkillImportStatus,
  type SkillImportCandidateStatus,
  type AgentSkillSource,
} from '@oh-my-harness/shared'
export interface SkillDetailDto {
  id: string
  name: string
  description: string
  pluginId?: string
  pluginName?: string
  source: AgentSkillSource
  content: string
  files: string[]
  filesTruncated: boolean
  canDelete: boolean
}

export interface SkillImportDto {
  id: string
  status: SkillImportStatus
  error?: string
  candidates: {
    key: string
    path: string
    name: string
    description: string
    status: SkillImportCandidateStatus
    message?: string
  }[]
}
