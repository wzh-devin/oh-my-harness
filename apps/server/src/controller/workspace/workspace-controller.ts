import { WorkspaceExecutionEnv } from '@oh-my-harness/agent-tools'
import {
  AgentRuntimeError,
  type AgentRuntime,
} from '@oh-my-harness/agent-runtime'
import type { Context } from 'hono'
import { glob } from 'node:fs/promises'

import type {
  CreateWorkspaceDto,
  FileEditorPreferenceDto,
  FileEditorSelectionDto,
  OpenWorkspaceFileDto,
  WorkspaceDto,
  WorkspaceFileDto,
} from '../../dto/workspace/workspace-dto.ts'
import type { FileEditorService } from '../../infrastructure/workspace/file-editor-service.ts'
import {
  WorkspaceError,
  type WorkspaceState,
  type WorkspaceStore,
} from '../../infrastructure/workspace/workspace-store.ts'
import { selectNativeWorkspaceDirectory } from '../../infrastructure/workspace/native-directory-picker.ts'

const MAX_PREVIEW_BYTES = 1024 * 1024

/** 为相对当前子目录的文件引用查找至多两个安全匹配，避免误开。 */
const findWorkspaceFilesBySuffix = async (
  environment: WorkspaceExecutionEnv,
  workspacePath: string,
  suffix: string,
) => {
  const normalizedSuffix = suffix.replace(/^(?:\.\/)+/u, '')
  const matches: string[] = []
  for await (const path of glob('**/*', {
    cwd: workspacePath,
    exclude: ['**/.git/**', '**/node_modules/**'],
  })) {
    if (path !== normalizedSuffix && !path.endsWith(`/${normalizedSuffix}`))
      continue
    const info = await environment.fileInfo(path)
    if (!info.ok || info.value.kind !== 'file') continue
    matches.push(path)
    if (matches.length === 2) break
  }
  return matches
}

function parseOpenWorkspaceFile(
  value: unknown,
): OpenWorkspaceFileDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    typeof record.path !== 'string' ||
    !record.path ||
    record.path.length > 4096 ||
    record.path.includes('\0')
  ) {
    return undefined
  }
  if (keys.length === 1 && keys[0] === 'path') {
    return { path: record.path }
  }
  if (
    keys.join(',') !== 'path,remember,selectionId' ||
    typeof record.selectionId !== 'string' ||
    !record.selectionId ||
    record.selectionId.length > 200 ||
    typeof record.remember !== 'boolean'
  ) {
    return undefined
  }
  return {
    path: record.path,
    remember: record.remember,
    selectionId: record.selectionId,
  }
}

function parseSelection(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 1 ||
    typeof record.selectionId !== 'string' ||
    !record.selectionId ||
    record.selectionId.length > 200
  ) {
    return undefined
  }
  return record.selectionId
}

function parseCreateWorkspace(value: unknown): CreateWorkspaceDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.path !== 'string') {
    return undefined
  }
  const path = record.path.trim()
  return path ? { path } : undefined
}

const toDto = (workspace: WorkspaceState): WorkspaceDto => ({
  available: workspace.available,
  createdAt: workspace.createdAt,
  id: workspace.id,
  name: workspace.name,
})

function workspaceErrorResponse(context: Context, error: unknown) {
  if (error instanceof WorkspaceError || error instanceof AgentRuntimeError) {
    return context.json(
      { code: error.code, message: error.message },
      error.status,
    )
  }
  return context.json(
    { code: 'WORKSPACE_REQUEST_FAILED', message: '工作区请求处理失败。' },
    500,
  )
}

function fileErrorResponse(context: Context, code: string) {
  if (code === 'permission_denied') {
    return context.json(
      { code: 'FILE_PREVIEW_FORBIDDEN', message: '该文件不在当前工作区内。' },
      403,
    )
  }
  if (code === 'not_found') {
    return context.json(
      { code: 'FILE_PREVIEW_NOT_FOUND', message: '文件不存在或已被删除。' },
      404,
    )
  }
  if (code === 'invalid' || code === 'is_directory') {
    return context.json(
      { code: 'INVALID_FILE_PREVIEW', message: '文件路径无效。' },
      400,
    )
  }
  return context.json(
    { code: 'FILE_PREVIEW_FAILED', message: '无法读取该文件。' },
    500,
  )
}

function fileOpenErrorResponse(context: Context, code: string) {
  if (code === 'permission_denied') {
    return context.json(
      { code: 'FILE_OPEN_FORBIDDEN', message: '该文件不在当前工作区内。' },
      403,
    )
  }
  if (code === 'not_found') {
    return context.json(
      { code: 'FILE_OPEN_NOT_FOUND', message: '文件不存在或已被删除。' },
      404,
    )
  }
  if (code === 'invalid' || code === 'is_directory') {
    return context.json(
      { code: 'INVALID_FILE_OPEN', message: '文件路径无效。' },
      400,
    )
  }
  return context.json(
    { code: 'FILE_OPEN_FAILED', message: '无法打开该文件。' },
    500,
  )
}

function requireFileEditorRequest(context: Context) {
  if (context.req.header('x-oh-my-harness-request') === 'file-editor')
    return true
  return context.json(
    { code: 'FILE_EDITOR_FORBIDDEN', message: '本地应用请求无效。' },
    403,
  )
}

/** 创建本地工作区注册与查询 Controller。 */
export function createWorkspaceController(
  workspaces: WorkspaceStore,
  dataDirectory: string,
  runtime: AgentRuntime,
  fileEditors: FileEditorService,
) {
  return {
    create: async (context: Context) => {
      const input = parseCreateWorkspace(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!input) {
        return context.json(
          { code: 'INVALID_WORKSPACE_REQUEST', message: '工作区请求无效。' },
          400,
        )
      }
      try {
        return context.json(toDto(await workspaces.create(input.path)), 201)
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    list: async (context: Context) => {
      try {
        return context.json((await workspaces.list()).map(toDto))
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    delete: async (context: Context) => {
      const workspaceId = context.req.param('workspaceId')?.trim()
      if (!workspaceId || workspaceId.length > 200) {
        return context.json(
          { code: 'INVALID_WORKSPACE_REQUEST', message: '工作区请求无效。' },
          400,
        )
      }
      try {
        await workspaces.delete(workspaceId, async (workspace) => {
          await runtime.deleteSessionsByCwd(workspace.path)
        })
        return context.body(null, 204)
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    readFile: async (context: Context) => {
      context.header('cache-control', 'no-store')
      context.header('x-content-type-options', 'nosniff')
      if (
        context.req.header('x-oh-my-harness-request') !==
        'workspace-file-preview'
      ) {
        return context.json(
          {
            code: 'FILE_PREVIEW_FORBIDDEN',
            message: '文件预览请求无效。',
          },
          403,
        )
      }
      const path = context.req.query('path')
      const workspaceId = context.req.param('workspaceId')
      if (!workspaceId || !path || path.length > 4096 || path.includes('\0')) {
        return context.json(
          { code: 'INVALID_FILE_PREVIEW', message: '文件路径无效。' },
          400,
        )
      }

      try {
        const workspace = await workspaces.requireAvailable(workspaceId)
        const environment = await WorkspaceExecutionEnv.create(workspace.path, [
          dataDirectory,
        ])
        const info = await environment.fileInfo(path)
        if (!info.ok) return fileErrorResponse(context, info.error.code)
        if (info.value.kind !== 'file') {
          return context.json(
            {
              code: 'INVALID_FILE_PREVIEW',
              message: '只能预览普通文件。',
            },
            400,
          )
        }
        if (info.value.size > MAX_PREVIEW_BYTES) {
          return context.json(
            {
              code: 'FILE_PREVIEW_TOO_LARGE',
              message: '文件超过 1 MiB，无法预览。',
            },
            413,
          )
        }

        const bytes = await environment.readBinaryFile(path)
        if (!bytes.ok) return fileErrorResponse(context, bytes.error.code)
        if (bytes.value.byteLength > MAX_PREVIEW_BYTES) {
          return context.json(
            {
              code: 'FILE_PREVIEW_TOO_LARGE',
              message: '文件超过 1 MiB，无法预览。',
            },
            413,
          )
        }
        let content: string
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.value,
          )
        } catch {
          return context.json(
            {
              code: 'FILE_PREVIEW_UNSUPPORTED',
              message: '该文件不是受支持的 UTF-8 文本。',
            },
            415,
          )
        }
        if (content.includes('\0')) {
          return context.json(
            {
              code: 'FILE_PREVIEW_UNSUPPORTED',
              message: '该文件不是受支持的文本文件。',
            },
            415,
          )
        }

        return context.json({
          content,
          modifiedAt: info.value.mtimeMs,
          path,
          size: bytes.value.byteLength,
        } satisfies WorkspaceFileDto)
      } catch (error) {
        if (
          !(error instanceof WorkspaceError) &&
          error &&
          typeof error === 'object' &&
          typeof (error as { code?: unknown }).code === 'string'
        ) {
          return fileErrorResponse(context, (error as { code: string }).code)
        }
        return workspaceErrorResponse(context, error)
      }
    },
    getFileEditor: async (context: Context) => {
      const forbidden = requireFileEditorRequest(context)
      if (forbidden !== true) return forbidden
      context.header('cache-control', 'no-store')
      try {
        const editor = await fileEditors.getDefaultEditor()
        return context.json({
          defaultEditor: editor ? { name: editor.name } : null,
          supported: fileEditors.supported,
        } satisfies FileEditorPreferenceDto)
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    selectFileEditor: async (context: Context) => {
      const forbidden = requireFileEditorRequest(context)
      if (forbidden !== true) return forbidden
      context.header('cache-control', 'no-store')
      try {
        const selection = await fileEditors.selectEditor()
        if (!selection) return context.body(null, 204)
        return context.json(selection satisfies FileEditorSelectionDto)
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    setDefaultFileEditor: async (context: Context) => {
      const forbidden = requireFileEditorRequest(context)
      if (forbidden !== true) return forbidden
      const selectionId = parseSelection(
        await context.req.json<unknown>().catch(() => undefined),
      )
      if (!selectionId) {
        return context.json(
          { code: 'INVALID_FILE_EDITOR_REQUEST', message: '应用选择无效。' },
          400,
        )
      }
      try {
        const editor = await fileEditors.rememberSelection(selectionId)
        return context.json({ name: editor.name })
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    clearDefaultFileEditor: async (context: Context) => {
      const forbidden = requireFileEditorRequest(context)
      if (forbidden !== true) return forbidden
      try {
        await fileEditors.clearDefaultEditor()
        return context.body(null, 204)
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
    openFile: async (context: Context) => {
      const forbidden = requireFileEditorRequest(context)
      if (forbidden !== true) return forbidden
      context.header('cache-control', 'no-store')
      const input = parseOpenWorkspaceFile(
        await context.req.json<unknown>().catch(() => undefined),
      )
      const workspaceId = context.req.param('workspaceId')
      if (!workspaceId || workspaceId.length > 200 || !input) {
        return context.json(
          { code: 'INVALID_FILE_OPEN', message: '文件打开请求无效。' },
          400,
        )
      }

      try {
        const workspace = await workspaces.requireAvailable(workspaceId)
        const environment = await WorkspaceExecutionEnv.create(workspace.path, [
          dataDirectory,
        ])
        let path = input.path
        let info = await environment.fileInfo(path)
        if (!info.ok && info.error.code === 'not_found') {
          const matches = await findWorkspaceFilesBySuffix(
            environment,
            workspace.path,
            path,
          )
          if (matches.length > 1) {
            return context.json(
              {
                code: 'FILE_OPEN_AMBIGUOUS',
                message: '工作区内存在多个匹配文件，请使用更完整的相对路径。',
              },
              409,
            )
          }
          if (matches[0]) {
            path = matches[0]
            info = await environment.fileInfo(path)
          }
        }
        if (!info.ok) return fileOpenErrorResponse(context, info.error.code)
        if (info.value.kind !== 'file') {
          return context.json(
            { code: 'INVALID_FILE_OPEN', message: '只能打开普通文件。' },
            400,
          )
        }
        const canonical = await environment.canonicalPath(path)
        if (!canonical.ok) {
          return fileOpenErrorResponse(context, canonical.error.code)
        }
        const result = await fileEditors.openFile(canonical.value, {
          remember: input.remember,
          selectionId: input.selectionId,
        })
        return context.json({
          editor: { name: result.editor.name },
          remembered: result.remembered,
        })
      } catch (error) {
        if (
          !(error instanceof WorkspaceError) &&
          error &&
          typeof error === 'object' &&
          typeof (error as { code?: unknown }).code === 'string'
        ) {
          return fileOpenErrorResponse(
            context,
            (error as { code: string }).code,
          )
        }
        return workspaceErrorResponse(context, error)
      }
    },
    select: async (context: Context) => {
      if (
        context.req.header('x-oh-my-harness-request') !== 'workspace-picker'
      ) {
        return context.json(
          {
            code: 'WORKSPACE_PICKER_FORBIDDEN',
            message: '工作区目录选择请求无效。',
          },
          403,
        )
      }
      try {
        const path = await selectNativeWorkspaceDirectory()
        if (path === null) return context.body(null, 204)
        return context.json(
          toDto(await workspaces.create(path, { reuseExisting: true })),
          201,
        )
      } catch (error) {
        return workspaceErrorResponse(context, error)
      }
    },
  }
}
