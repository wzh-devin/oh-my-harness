import {
  type SkillImportStatus,
  type SkillImportCandidateStatus,
  type SkillInstallStatus,
  type AgentSkillSource,
} from '@oh-my-harness/shared'
import { pluginRequest } from './plugin-api.ts'

export interface SkillDetailVo {
  id: string
  name: string
  description: string
  source: AgentSkillSource
  pluginId?: string
  content: string
  files: string[]
  filesTruncated: boolean
  canDelete: boolean
}

/** 按稳定 ID 获取详情，不接收宿主路径。 */
export const getSkillDetail = (id: string, signal: AbortSignal) =>
  pluginRequest<SkillDetailVo>(`skills/${encodeURIComponent(id)}`, { signal })

/** 独立技能移入服务端回收目录；插件内技能由后端拒绝单独删除。 */
export const deleteSkill = (id: string) =>
  pluginRequest<{ message: string }>(`skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

export interface SkillImportVo {
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

/** 复用插件设置请求传输，技能导入保持独立 API 契约。 */
export const createSkillImport = (source: string, file: File | null) => {
  const form = new FormData()
  if (file) form.set('file', file)
  return pluginRequest<SkillImportVo>('skill-imports', {
    method: 'POST',
    body: file ? form : { url: source.trim() },
  })
}

/** 读取服务端技能解析状态。 */
export const getSkillImport = (id: string, signal: AbortSignal) =>
  pluginRequest<SkillImportVo>(`skill-imports/${id}`, { signal })

/** 服务端重新校验候选后导入，幂等返回稳定技能 ID。 */
export const installSkillImport = (id: string, candidate: string) =>
  pluginRequest<{
    skillId: string
    name: string
    status: SkillInstallStatus
  }>(`skill-imports/${id}/install`, { method: 'POST', body: { candidate } })

/** 释放导入暂存；取消不删除已安装技能。 */
export const cancelSkillImport = (id: string) =>
  pluginRequest<void>(`skill-imports/${id}`, { method: 'DELETE' })
