import {
  TOOL_PERMISSION,
  TOOL_PERMISSIONS,
  type ToolPermission,
} from '@oh-my-harness/agent-policy/contracts'
import { createContext, useContext } from 'react'

const permissionPresentation = {
  [TOOL_PERMISSION.READ_ONLY]: {
    label: '请求批准',
    description: '文件修改、外部访问与命令均需批准',
  },
  [TOOL_PERMISSION.WORKSPACE_WRITE]: {
    label: '帮我批准',
    description: '工作区文件自动处理，其他操作需批准',
  },
  [TOOL_PERMISSION.FULL_ACCESS]: {
    label: '完全访问权限',
    description: '文件、命令与联网操作无需逐次批准',
  },
} satisfies Record<ToolPermission, { label: string; description: string }>

export const PERMISSION_OPTIONS = TOOL_PERMISSIONS.map((id) => ({
  id,
  ...permissionPresentation[id],
}))
export type PermissionId = ToolPermission

export interface PermissionSelection {
  permission: PermissionId
  scope: string
  sessionPermission: PermissionId
}

/** 切换会话或恢复服务端权限时丢弃旧草稿，当前会话内保留未发送选择。 */
export const resolvePermissionSelection = (
  current: PermissionSelection,
  scope: string,
  sessionPermission: PermissionId,
): PermissionSelection =>
  current.scope === scope && current.sessionPermission === sessionPermission
    ? current
    : { permission: sessionPermission, scope, sessionPermission }

interface PermissionSettingsContextValue {
  permission: PermissionId
  setPermission: (permission: PermissionId) => void
}

export const PermissionSettingsContext =
  createContext<PermissionSettingsContextValue | null>(null)

/** 读取当前页面会话的工作区权限选择。 */
export const usePermissionSettings = () => {
  const permissionSettings = useContext(PermissionSettingsContext)

  if (!permissionSettings) {
    throw new Error(
      'usePermissionSettings 必须在 PermissionSettingsContext.Provider 内使用。',
    )
  }

  return permissionSettings
}
