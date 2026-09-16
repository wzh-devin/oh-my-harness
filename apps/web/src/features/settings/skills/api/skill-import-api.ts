import {
  type SkillImportStatus,
  type SkillImportCandidateStatus,
  type SkillInstallStatus,
  type AgentSkillSource,
} from '@oh-my-harness/shared'
/** 统一处理独立技能的 JSON/ZIP 请求、取消与服务端错误。 */
const skillRequest = async <T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> => {
  const form = options.body instanceof FormData
  const response = await fetch(`/api/${path}`, {
    method: options.method ?? 'GET',
    signal: options.signal,
    ...(options.body === undefined
      ? {}
      : {
          headers: form ? undefined : { 'Content-Type': 'application/json' },
          body: form
            ? (options.body as FormData)
            : JSON.stringify(options.body),
        }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => undefined)
    throw new Error(data?.message ?? `技能请求失败（${response.status}）`)
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>)
}

export interface SkillDetailVo {
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

/** 按稳定 ID 获取详情，不接收宿主路径。 */
export const getSkillDetail = (id: string, signal: AbortSignal) =>
  skillRequest<SkillDetailVo>(`skills/${encodeURIComponent(id)}`, { signal })

/** 独立技能移入服务端回收目录，保留恢复副本。 */
export const deleteSkill = (id: string) =>
  skillRequest<{ message: string }>(`skills/${encodeURIComponent(id)}`, {
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

/** 创建独立技能导入，文件内容仅交给受控服务端解析。 */
export const createSkillImport = (source: string, file: File | null) => {
  const form = new FormData()
  if (file) form.set('file', file)
  return skillRequest<SkillImportVo>('skill-imports', {
    method: 'POST',
    body: file ? form : { url: source.trim() },
  })
}

/** 读取服务端技能解析状态。 */
export const getSkillImport = (id: string, signal: AbortSignal) =>
  skillRequest<SkillImportVo>(`skill-imports/${id}`, { signal })

/** 服务端重新校验候选后导入，幂等返回稳定技能 ID。 */
export const installSkillImport = (id: string, candidate: string) =>
  skillRequest<{
    skillId: string
    name: string
    status: SkillInstallStatus
  }>(`skill-imports/${id}/install`, { method: 'POST', body: { candidate } })

/** 释放导入暂存；取消不删除已安装技能。 */
export const cancelSkillImport = (id: string) =>
  skillRequest<void>(`skill-imports/${id}`, { method: 'DELETE' })
