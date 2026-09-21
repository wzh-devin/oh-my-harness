import type {
  OAuthSessionStatusVo,
  ProviderInfoVo,
  ProviderModelInfoVo,
} from '../types/provider-vo.ts'

interface ApiKeyCredentialRequest {
  apiKey: string
}

interface OAuthSessionInputRequest {
  promptId: string
  value: string
}

interface ProviderConfigUpdate {
  models: Array<{ id: string; name?: string; maxOutputTokens?: number }>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined
    throw new Error(body?.message ?? `请求失败（${response.status}）`)
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T)
}

/** 获取首批 Provider、模型和非秘密认证状态。 */
export const getProviders = () => request<ProviderInfoVo[]>('/api/ai/providers')

/** 从服务端 Pi AI Provider 读取完整模型目录。 */
export const getProviderModels = (providerId: string) =>
  request<ProviderModelInfoVo[]>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/models`,
  )

/** 保存 Provider API Key；响应不会回显密钥。 */
export const saveProviderApiKey = (
  providerId: string,
  body: ApiKeyCredentialRequest,
) =>
  request<void>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/credential`,
    {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    },
  )

/** 原子替换 Provider 已启用模型；候选目录不会自动写入。 */
export const saveProviderConfig = (
  providerId: string,
  body: ProviderConfigUpdate,
) =>
  request<ProviderInfoVo>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/config`,
    {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    },
  )

/** 删除 Provider 的凭证和已保存模型配置。 */
export const deleteProvider = (providerId: string) =>
  request<void>(`/api/ai/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  })

/** 创建由 Pi AI 执行的 OAuth 登录会话。 */
export const createOAuthSession = (providerId: string, authMode?: string) =>
  request<OAuthSessionStatusVo>('/api/ai/oauth/sessions', {
    body: JSON.stringify({ authMode, providerId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

/** 查询 OAuth 登录会话。 */
export const getOAuthSession = (sessionId: string) =>
  request<OAuthSessionStatusVo>(
    `/api/ai/oauth/sessions/${encodeURIComponent(sessionId)}`,
  )

/** 回答 Pi AI OAuth prompt。 */
export const submitOAuthInput = (
  sessionId: string,
  body: OAuthSessionInputRequest,
) =>
  request<OAuthSessionStatusVo>(
    `/api/ai/oauth/sessions/${encodeURIComponent(sessionId)}/input`,
    {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  )

/** 取消 OAuth 登录会话。 */
export const cancelOAuthSession = (sessionId: string) =>
  request<void>(`/api/ai/oauth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
