import { MODEL_THINKING_LEVEL } from '@oh-my-harness/shared'
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
  type PermissionSelection,
  resolvePermissionSelection,
} from '../contexts/permission-settings-context.ts'
import {
  CapabilitySettingsContext,
  type AssistantSkill,
  type CapabilityCommand,
} from '../contexts/capability-settings-context.ts'

interface SettingsProviderProps {
  children: ReactNode
  permissionScope: string
  selectedWorkspaceId: string
  sessionPermission: PermissionId
}

/** 持有模型、权限、当前工作区 Skills 与命令状态。 */
export function SettingsProvider({
  children,
  permissionScope,
  selectedWorkspaceId,
  sessionPermission,
}: SettingsProviderProps) {
  const [providers, setProviders] = useState(createInitialModelProviders)
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel>(
    MODEL_THINKING_LEVEL.OFF,
  )
  const [permissionSelection, setPermissionSelection] =
    useState<PermissionSelection>({
      permission: sessionPermission,
      scope: permissionScope,
      sessionPermission,
    })
  const resolvedPermissionSelection = resolvePermissionSelection(
    permissionSelection,
    permissionScope,
    sessionPermission,
  )
  if (resolvedPermissionSelection !== permissionSelection) {
    setPermissionSelection(resolvedPermissionSelection)
  }
  const permission = resolvedPermissionSelection.permission
  const setPermission = (next: PermissionId) =>
    setPermissionSelection({
      permission: next,
      scope: permissionScope,
      sessionPermission,
    })
  const [skills, setSkills] = useState<AssistantSkill[]>([])
  const [commands, setCommands] = useState<CapabilityCommand[]>([])
  const [capabilityError, setCapabilityError] = useState<string | null>(null)
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false)
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
        setCapabilityError(null)
        setIsLoadingCapabilities(false)
        return
      }
      setIsLoadingCapabilities(true)
      void getAgentCapabilities(selectedWorkspaceId, controller.signal)
        .then((catalog) => {
          if (controller.signal.aborted) return
          setSkills(catalog.skills)
          setCommands(catalog.commands)
          // 目录已过滤不可用条目；诊断也包含可恢复警告，不能按条数误报加载失败。
          setCapabilityError(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
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
        <CapabilitySettingsContext.Provider
          value={{
            capabilityError,
            commands,
            isLoadingCapabilities,
            refreshCapabilities,
            setSkills,
            skills,
          }}
        >
          {children}
        </CapabilitySettingsContext.Provider>
      </ModelSettingsContext.Provider>
    </PermissionSettingsContext.Provider>
  )
}
