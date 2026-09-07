import { TOOL_PERMISSION } from '@oh-my-harness/agent-policy/contracts'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getProviders } from '../../models/api/index.ts'
import {
  createInitialModelProviders,
  toModelProvider,
} from '../../models/data/provider-models.ts'
import type { ModelThinkingLevel } from '../../models/types/provider-vo.ts'
import { getAgentCapabilities } from '../api/index.ts'
import { ModelSettingsContext } from '../contexts/model-settings-context.ts'
import {
  PermissionSettingsContext,
  type PermissionId,
} from '../contexts/permission-settings-context.ts'
import {
  PluginSettingsContext,
  type AssistantSkill,
  type CapabilityCommand,
  type CapabilityPlugin,
  type PluginSettingsTab,
} from '../contexts/plugin-settings-context.ts'

interface SettingsProviderProps {
  children: ReactNode
  onOpenPluginSettings: (tab: PluginSettingsTab) => void
  selectedWorkspaceId: string
  permissionScope: string
}

/** 持有模型、权限、当前工作区能力与插件设置状态。 */
export function SettingsProvider({
  children,
  onOpenPluginSettings,
  selectedWorkspaceId,
  permissionScope,
}: SettingsProviderProps) {
  const [providers, setProviders] = useState(createInitialModelProviders)
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel>('off')
  const [permissionSelection, setPermissionSelection] = useState<{
    scope: string
    permission: PermissionId
  }>({ scope: permissionScope, permission: TOOL_PERMISSION.workspaceWrite })
  const permission =
    permissionSelection.scope === permissionScope
      ? permissionSelection.permission
      : TOOL_PERMISSION.workspaceWrite
  if (permissionSelection.scope !== permissionScope) {
    setPermissionSelection({
      scope: permissionScope,
      permission: TOOL_PERMISSION.workspaceWrite,
    })
  }
  /** 新会话或工作区不继承上一处的完全访问选择。 */
  const setPermission = (next: PermissionId) =>
    setPermissionSelection({ scope: permissionScope, permission: next })
  const [skills, setSkills] = useState<AssistantSkill[]>([])
  const [commands, setCommands] = useState<CapabilityCommand[]>([])
  const [capabilityError, setCapabilityError] = useState<string | null>(null)
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false)
  const [plugins, setPlugins] = useState<CapabilityPlugin[]>([])
  const [capabilityRevision, setCapabilityRevision] = useState(0)
  const refreshCapabilities = useCallback(
    () => setCapabilityRevision((value) => value + 1),
    [],
  )

  /** 重新读取服务端 Provider 能力与认证状态。 */
  const refreshProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    try {
      const serverProviders = (await getProviders()).map(toModelProvider)
      setProviders((current) => [
        ...serverProviders,
        ...current.filter(
          (provider) =>
            provider.isCustom &&
            !serverProviders.some((item) => item.id === provider.id),
        ),
      ])
      setProviderError(null)
    } catch (error) {
      setProviderError((error as Error).message)
    } finally {
      setIsLoadingProviders(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refreshProviders())
  }, [refreshProviders])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      if (!selectedWorkspaceId) {
        setSkills([])
        setCommands([])
        setPlugins([])
        setCapabilityError(null)
        setIsLoadingCapabilities(false)
        return
      }
      setIsLoadingCapabilities(true)
      void getAgentCapabilities(selectedWorkspaceId, controller.signal)
        .then((catalog) => {
          if (controller.signal.aborted) return
          setPlugins(catalog.plugins)
          setSkills(catalog.skills)
          setCommands(catalog.commands)
          setCapabilityError(
            catalog.diagnostics.length
              ? `${catalog.diagnostics.length} 个能力文件未能加载。`
              : null,
          )
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setPlugins([])
          setSkills([])
          setCommands([])
          setCapabilityError(
            error instanceof Error ? error.message : '能力目录请求失败。',
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoadingCapabilities(false)
        })
    })
    return () => controller.abort()
  }, [selectedWorkspaceId, capabilityRevision])

  return (
    <PermissionSettingsContext.Provider value={{ permission, setPermission }}>
      <ModelSettingsContext.Provider
        value={{
          error: providerError,
          isLoading: isLoadingProviders,
          providers,
          refreshProviders,
          setProviders,
          setThinkingLevel,
          thinkingLevel,
        }}
      >
        <PluginSettingsContext.Provider
          value={{
            capabilityError,
            commands,
            isLoadingCapabilities,
            openPluginSettings: onOpenPluginSettings,
            plugins,
            refreshCapabilities,
            setSkills,
            skills,
          }}
        >
          {children}
        </PluginSettingsContext.Provider>
      </ModelSettingsContext.Provider>
    </PermissionSettingsContext.Provider>
  )
}
