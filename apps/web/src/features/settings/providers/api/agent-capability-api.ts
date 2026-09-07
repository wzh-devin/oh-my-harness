import type {
  AssistantSkill,
  CapabilityCommand,
  CapabilityPlugin,
} from '../contexts/plugin-settings-context.ts'

export interface AgentCapabilityDiagnosticVo {
  code: string
  message: string
  source: AssistantSkill['source'] | CapabilityCommand['source']
}

export interface AgentCapabilityCatalogVo {
  plugins: CapabilityPlugin[]
  commands: CapabilityCommand[]
  diagnostics: AgentCapabilityDiagnosticVo[]
  skills: AssistantSkill[]
}

/** 读取由服务端验证工作区后解析的真实 Skills 与命令。 */
export const getAgentCapabilities = async (
  workspaceId: string,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({ workspaceId })
  const response = await fetch(`/api/agent/capabilities?${query}`, { signal })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined
    throw new Error(body?.message ?? `能力目录请求失败（${response.status}）`)
  }
  return (await response.json()) as AgentCapabilityCatalogVo
}
