import type {
  AgentSkillSource,
  AgentCommandSource,
  CapabilityScope,
  McpSettingsConnectionStatus,
  McpTransport,
  PluginSettingsTab,
} from '@oh-my-harness/shared'
import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from 'react'

export type { McpTransport, PluginSettingsTab }
export type McpConnectionStatus = McpSettingsConnectionStatus
export type SkillSource = AgentSkillSource
export interface CapabilityPlugin {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface AssistantSkill {
  pluginId?: string
  description: string
  enabled: boolean
  id: string
  name: string
  source: SkillSource
}

export interface CapabilityCommand {
  pluginId?: string
  description: string
  id: string
  name: string
  source: AgentCommandSource
}

export interface McpServer {
  description: string
  enabled: boolean
  endpoint: string
  id: string
  name: string
  scope: CapabilityScope
  status: McpConnectionStatus
  transport: McpTransport
}

interface PluginSettingsContextValue {
  capabilityError: string | null
  commands: CapabilityCommand[]
  isLoadingCapabilities: boolean
  openPluginSettings: (tab: PluginSettingsTab) => void
  plugins: CapabilityPlugin[]
  refreshCapabilities(): void
  setSkills: Dispatch<SetStateAction<AssistantSkill[]>>
  skills: AssistantSkill[]
}

export const PluginSettingsContext =
  createContext<PluginSettingsContextValue | null>(null)

/** 读取当前工作区真实能力和插件设置入口。 */
export const usePluginSettings = () => {
  const pluginSettings = useContext(PluginSettingsContext)

  if (!pluginSettings) {
    throw new Error('usePluginSettings 必须在 PluginSettingsProvider 内使用。')
  }

  return pluginSettings
}
