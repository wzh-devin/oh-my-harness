import { ToolPolicy } from '@oh-my-harness/agent-policy'
import { PluginService } from '@oh-my-harness/agent-plugins'
import { McpConnectionService } from '@oh-my-harness/agent-tools'
import { FileMcpCredentialStore } from './infrastructure/plugins/mcp-credential-store.ts'
import { createPluginRouter } from './router/plugins/plugin-router.ts'
import { AgentRuntime, SkillImportService } from '@oh-my-harness/agent-runtime'
import { createSkillImportRouter } from './router/plugins/skill-import-router.ts'
import {
  createProviderModels,
  FileCredentialStore,
  FileProviderConfigStore,
  getDefaultDataDirectory,
  ModelService,
  OAuthSessionService,
} from '@oh-my-harness/llm'
import { Hono } from 'hono'

import { createJsonlSessionRepository } from './infrastructure/session/jsonl-session.ts'
import { SessionIndex } from './infrastructure/session/session-index.ts'
import { FileEditorService } from './infrastructure/workspace/file-editor-service.ts'
import { WorkspaceStore } from './infrastructure/workspace/workspace-store.ts'
import { createApiRouter } from './router/index.ts'

export interface CreateAppOptions {
  fileEditors?: FileEditorService
  models?: ModelService
}

export type OhMyHarnessApp = Hono & { close(): Promise<void> }

/** 创建 oh-my-harness 本地后端业务应用。 */
export async function createApp(
  dataDirectory = process.env.OH_MY_HARNESS_DATA_DIR ??
    getDefaultDataDirectory(),
  options: CreateAppOptions = {},
) {
  const app = new Hono() as OhMyHarnessApp
  let models = options.models
  if (!models) {
    const credentials = new FileCredentialStore(dataDirectory)
    const configurations = new FileProviderConfigStore(dataDirectory)
    await credentials.list()
    await configurations.list()
    models = new ModelService(createProviderModels(credentials), configurations)
  }
  const oauth = new OAuthSessionService(models.models)
  const repository = await createJsonlSessionRepository(dataDirectory)
  const sessionIndex = await SessionIndex.create(dataDirectory, repository)
  const workspaces = new WorkspaceStore(dataDirectory)
  const fileEditors =
    options.fileEditors ?? new FileEditorService(dataDirectory)
  await workspaces.list()
  const plugins = new PluginService(
    dataDirectory,
    process.env.OH_MY_HARNESS_PLUGIN_GIT_HOSTS?.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  )
  await plugins.list()
  const connections = new McpConnectionService(
    new FileMcpCredentialStore(dataDirectory),
    `${process.env.OH_MY_HARNESS_PUBLIC_URL ?? `http://127.0.0.1:${process.env.OH_MY_HARNESS_SERVER_PORT ?? 4318}`}/api/plugin-oauth-sessions/callback`,
  )
  const runtime = new AgentRuntime(models, repository, sessionIndex, {
    dataDirectory,
    plugins,
    connections,
    policy: new ToolPolicy(),
    protectedRoots: [dataDirectory],
  })
  let closed = false
  const skillImports = new SkillImportService(
    dataDirectory,
    process.env.OH_MY_HARNESS_PLUGIN_GIT_HOSTS?.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  )
  app.close = async () => {
    if (closed) return
    closed = true
    await runtime.close()
    await skillImports.close()
    connections.close()
    await plugins.close()
    await sessionIndex.close()
  }

  app.route(
    '/api',
    createApiRouter(
      models,
      oauth,
      runtime,
      workspaces,
      dataDirectory,
      fileEditors,
    ),
  )
  app.route('/api', createPluginRouter(plugins, connections))
  app.route(
    '/api',
    createSkillImportRouter(skillImports, runtime, connections.redirectUrl),
  )

  return app
}
