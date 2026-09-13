import type { AgentRuntime } from '@oh-my-harness/agent-runtime'
import type { Context } from 'hono'

import type { AgentCapabilityCatalogDto } from '../../dto/agent/capability-dto.ts'
import type { WorkspaceStore } from '../../infrastructure/workspace/workspace-store.ts'
import { agentErrorResponse } from './error-response.ts'

/** 返回由服务端工作区与本地目录解析的 Skills 和命令目录。 */
export const createAgentCapabilityController =
  (runtime: AgentRuntime, workspaces: WorkspaceStore) =>
  async (context: Context) => {
    const workspaceId = context.req.query('workspaceId')?.trim()
    if (!workspaceId || workspaceId.length > 200) {
      return context.json(
        { code: 'INVALID_SESSION_REQUEST', message: '工作区参数无效。' },
        400,
      )
    }
    try {
      const workspace = await workspaces.requireAvailable(workspaceId)
      const catalog = await runtime.listCapabilitiesForWorkspace(workspace.path)
      return context.json(catalog satisfies AgentCapabilityCatalogDto)
    } catch (error) {
      return agentErrorResponse(context, error)
    }
  }
