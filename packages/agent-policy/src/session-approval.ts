import { isAbsolute } from 'node:path'

import { FILE_SCOPE, TOOL_EFFECT } from '@oh-my-harness/shared'

import {
  POLICY_TOOL,
  getFileTool,
  isToolPermission,
  type SessionApprovalGrant,
  type ToolAuthorizationRequest,
} from './contracts.ts'

const validText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0')

/** 会话授权只保存服务端已解析的内置工具请求，不包含运行标识或 MCP。 */
export const createSessionApprovalGrant = (
  request: ToolAuthorizationRequest,
): SessionApprovalGrant | undefined => {
  if (request.effect === TOOL_EFFECT.MCP_CALL) return
  if (request.effect === TOOL_EFFECT.EXECUTE)
    return {
      schemaVersion: 1,
      permission: request.permission,
      ...POLICY_TOOL.BASH,
      command: request.command,
      cwd: request.cwd,
    }
  const fileTool = getFileTool(request.toolName)
  if (!fileTool) return
  return {
    schemaVersion: 1,
    permission: request.permission,
    ...fileTool,
    path: request.path,
    scope: request.scope,
  }
}

/** JSONL 中的未知或损坏授权按未授权处理。 */
export const parseSessionApprovalGrant = (
  value: unknown,
): SessionApprovalGrant | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const grant = value as Record<string, unknown>
  if (grant.schemaVersion !== 1 || !isToolPermission(grant.permission)) return
  if (grant.effect === TOOL_EFFECT.EXECUTE) {
    if (
      grant.toolName !== POLICY_TOOL.BASH.toolName ||
      !validText(grant.command) ||
      !validText(grant.cwd) ||
      !isAbsolute(grant.cwd)
    )
      return
    return {
      schemaVersion: 1,
      permission: grant.permission,
      ...POLICY_TOOL.BASH,
      command: grant.command,
      cwd: grant.cwd,
    }
  }
  const fileTool = getFileTool(grant.toolName)
  if (
    !fileTool ||
    grant.effect !== fileTool.effect ||
    !validText(grant.path) ||
    (grant.scope !== FILE_SCOPE.ATTACHMENT &&
      grant.scope !== FILE_SCOPE.WORKSPACE &&
      grant.scope !== FILE_SCOPE.EXTERNAL) ||
    (grant.scope !== FILE_SCOPE.WORKSPACE && !isAbsolute(grant.path))
  )
    return
  return {
    schemaVersion: 1,
    permission: grant.permission,
    ...fileTool,
    path: grant.path,
    scope: grant.scope,
  }
}

export const sessionApprovalKey = (grant: SessionApprovalGrant): string =>
  JSON.stringify(grant)
