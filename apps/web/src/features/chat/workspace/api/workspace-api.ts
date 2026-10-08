export interface WorkspaceVo {
  available: boolean
  createdAt: number
  id: string
  name: string
}

export interface WorkspaceFileVo {
  content: string
  modifiedAt: number
  path: string
  size: number
}

export interface FileEditorVo {
  name: string
}

export interface FileEditorSelectionVo extends FileEditorVo {
  selectionId: string
}

export interface FileEditorPreferenceVo {
  defaultEditor: FileEditorVo | null
  supported: boolean
}

export interface OpenWorkspaceFileVo {
  editor: FileEditorVo
  remembered: boolean
}

export class WorkspaceApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status = 0) {
    super(message)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined
    throw new WorkspaceApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code ?? 'WORKSPACE_REQUEST_FAILED',
      response.status,
    )
  }
  if (response.status === 204) return null as T
  return (await response.json()) as T
}

/** 读取服务端持久化的工作区列表。 */
export const listWorkspaces = () => request<WorkspaceVo[]>('/api/workspaces')

/** 请求本地 Server 打开系统目录选择器，取消时返回 null。 */
export const selectWorkspace = () =>
  request<WorkspaceVo | null>('/api/workspaces/select', {
    headers: { 'x-oh-my-harness-request': 'workspace-picker' },
    method: 'POST',
  })

/** 注册一个由服务端校验和规范化的本地工作区。 */
export const createWorkspace = (path: string) =>
  request<WorkspaceVo>('/api/workspaces', {
    body: JSON.stringify({ path }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

/** 删除工作区注册及其全部会话，不删除磁盘目录。 */
export const deleteWorkspace = (workspaceId: string) =>
  request<void>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'DELETE',
  })

/** 读取注册工作区内经过服务端边界校验的 UTF-8 文本文件。 */
export const readWorkspaceFile = (
  workspaceId: string,
  path: string,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({ path })
  return request<WorkspaceFileVo>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/content?${query}`,
    {
      headers: { 'x-oh-my-harness-request': 'workspace-file-preview' },
      signal,
    },
  )
}

/** 读取工作区内经服务端签名校验的图片，用于消息内联预览。 */
export const readWorkspaceImage = async (
  workspaceId: string,
  path: string,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({ path })
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/image?${query}`,
    {
      headers: { 'x-oh-my-harness-request': 'workspace-file-preview' },
      signal,
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { code?: string; message?: string } | undefined
    throw new WorkspaceApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code ?? 'FILE_PREVIEW_FAILED',
      response.status,
    )
  }
  const mimeType = response.headers.get('content-type') ?? ''
  if (!mimeType.startsWith('image/')) {
    throw new WorkspaceApiError(
      '服务端返回的内容不是图片。',
      'FILE_PREVIEW_UNSUPPORTED',
      415,
    )
  }
  return { blob: await response.blob(), mimeType }
}

const FILE_EDITOR_HEADERS = { 'x-oh-my-harness-request': 'file-editor' }

/** 查询运行 oh-my-harness Server 的电脑所使用的默认文件编辑器。 */
export const getFileEditorPreference = () =>
  request<FileEditorPreferenceVo>('/api/workspaces/file-editor', {
    headers: FILE_EDITOR_HEADERS,
  })

/** 调起 Server 所在 macOS 的原生应用选择器。 */
export const selectFileEditor = () =>
  request<FileEditorSelectionVo | null>('/api/workspaces/file-editor/select', {
    headers: FILE_EDITOR_HEADERS,
    method: 'POST',
  })

/** 把一次服务端应用选择保存为默认编辑器。 */
export const setDefaultFileEditor = (selectionId: string) =>
  request<FileEditorVo>('/api/workspaces/file-editor/default', {
    body: JSON.stringify({ selectionId }),
    headers: { ...FILE_EDITOR_HEADERS, 'content-type': 'application/json' },
    method: 'PUT',
  })

/** 清除默认编辑器，让下次点击文件时重新选择。 */
export const clearDefaultFileEditor = () =>
  request<void>('/api/workspaces/file-editor/default', {
    headers: FILE_EDITOR_HEADERS,
    method: 'DELETE',
  })

/** 使用默认编辑器或一次性选择，在 Server 所在电脑上打开工作区文件。 */
export const openWorkspaceFile = (
  workspaceId: string,
  path: string,
  selection?: { remember: boolean; selectionId: string },
) =>
  request<OpenWorkspaceFileVo>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/files/open`,
    {
      body: JSON.stringify({ path, ...selection }),
      headers: { ...FILE_EDITOR_HEADERS, 'content-type': 'application/json' },
      method: 'POST',
    },
  )
