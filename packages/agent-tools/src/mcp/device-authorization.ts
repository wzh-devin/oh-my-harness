import { setTimeout as delay } from 'node:timers/promises'
import {
  OAuthTokensSchema,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'
import { configObject, McpError } from './config.ts'
import type { McpAuthProfile } from './auth-profile.ts'

type DeviceProfile = NonNullable<McpAuthProfile['device']>
type Client = { client_id: string; client_secret?: string }
export interface DeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}
const failure = (message: string) =>
  new McpError(MCP_ERROR_CODE.UNAVAILABLE, message)
const text = (value: unknown, maximum = 8192): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\r\n\0]/u.test(value)

/** 请求通过调用方的安全 fetcher；响应原文和设备码不进入错误提示。 */
async function request(
  fetcher: typeof fetch,
  url: string,
  client: Client,
  fields: Record<string, string>,
  signal: AbortSignal,
) {
  const response = await fetcher(url, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...client, ...fields }),
  })
  const value = configObject(await response.json())
  if (!response.ok && ![400, 401].includes(response.status))
    throw failure(`授权服务返回 HTTP ${response.status}，请稍后重试。`)
  if (!response.ok && !value.error)
    throw failure('授权服务拒绝请求，请检查客户端配置。')
  return value
}

/** RFC 8628 设备码启动；校验用户确认页与管理员配置完全一致。 */
export async function startDeviceAuthorization(
  profile: DeviceProfile,
  client: Client,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<DeviceAuthorization> {
  const value = await request(
    fetcher,
    profile.authorizationUrl,
    client,
    {
      ...(profile.scopes?.length ? { scope: profile.scopes.join(' ') } : {}),
    },
    signal,
  )
  if (value.error)
    throw failure(
      '无法开始设备授权，请管理员检查客户端是否已开启 Device Flow。',
    )
  const interval = value.interval ?? 5
  if (
    !text(value.device_code) ||
    !text(value.user_code, 100) ||
    value.verification_uri !== profile.verificationUrl ||
    !Number.isSafeInteger(value.expires_in) ||
    Number(value.expires_in) < 1 ||
    Number(value.expires_in) > 1800 ||
    !Number.isSafeInteger(interval) ||
    Number(interval) < 1 ||
    Number(interval) > 60
  )
    throw failure('设备授权响应无效。')
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: profile.verificationUrl,
    expiresAt: Date.now() + Number(value.expires_in) * 1000,
    interval: Number(interval) * 1000,
  }
}

/** 仅处理协议轮询；取消、状态、令牌持久化由 McpAuth 统一管理。 */
export async function pollDeviceAuthorization(
  device: DeviceAuthorization,
  profile: DeviceProfile,
  client: Client,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<OAuthTokens> {
  let interval = device.interval
  while (Date.now() < device.expiresAt) {
    await delay(Math.min(interval, device.expiresAt - Date.now()), undefined, {
      signal,
    })
    if (Date.now() >= device.expiresAt) break
    let value: Record<string, unknown>
    try {
      value = await request(
        fetcher,
        profile.tokenUrl,
        client,
        {
          device_code: device.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        signal,
      )
    } catch (error) {
      if (
        !signal.aborted &&
        error instanceof Error &&
        error.name === 'TimeoutError'
      ) {
        interval *= 2
        continue
      }
      throw error
    }
    if (value.error === 'authorization_pending') continue
    if (value.error === 'slow_down') {
      interval += 5000
      continue
    }
    if (value.error)
      throw failure(
        value.error === 'access_denied'
          ? '账号授权已拒绝。'
          : '设备授权已失效，请重新连接。',
      )
    return OAuthTokensSchema.parse(value)
  }
  throw failure('设备授权已过期，请重新连接。')
}

/** 设备流刷新与首次授权使用同一个令牌端点，不重放任何业务调用。 */
export async function refreshDeviceAuthorization(
  profile: DeviceProfile,
  client: Client,
  refreshToken: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<OAuthTokens> {
  const value = await request(
    fetcher,
    profile.tokenUrl,
    client,
    { refresh_token: refreshToken, grant_type: 'refresh_token' },
    signal,
  )
  if (value.error) throw failure('账号授权已失效，请重新连接。')
  return OAuthTokensSchema.parse(value)
}
