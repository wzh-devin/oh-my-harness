import type {
  AgentSkillSource,
  AgentCommandSource,
} from '@oh-my-harness/shared'
import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from 'react'

export type SkillSource = AgentSkillSource

export interface AssistantSkill {
  description: string
  enabled: boolean
  id: string
  name: string
  source: SkillSource
}

export interface CapabilityCommand {
  description: string
  id: string
  name: string
  source: AgentCommandSource
}

interface CapabilitySettingsContextValue {
  capabilityError: string | null
  commands: CapabilityCommand[]
  isLoadingCapabilities: boolean
  refreshCapabilities(): void
  setSkills: Dispatch<SetStateAction<AssistantSkill[]>>
  skills: AssistantSkill[]
}

export const CapabilitySettingsContext =
  createContext<CapabilitySettingsContextValue | null>(null)

/** 读取当前工作区真实 Skills 与命令。 */
export const useCapabilitySettings = () => {
  const capabilitySettings = useContext(CapabilitySettingsContext)

  if (!capabilitySettings) {
    throw new Error('useCapabilitySettings 必须在 SettingsProvider 内使用。')
  }

  return capabilitySettings
}
