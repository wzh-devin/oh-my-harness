import { configObject, McpError } from './config.ts'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'

export interface McpAuthProfile {
  setupUrl?: string
  authorizationParams?: Record<string, string>
  device?: {
    authorizationUrl: string
    tokenUrl: string
    verificationUrl: string
    scopes?: string[]
    account?: {
      url: string
      nameField: string
      headers?: Record<string, string>
    }
  }
}

/** 只接收部署管理员配置；插件清单不能注入设备授权端点或覆盖协议参数。 */
export function parseAuthProfiles(
  value: unknown,
): Record<string, McpAuthProfile> {
  const invalid = () => {
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      '管理员授权服务配置无效。',
    )
  }
  const object = (input: unknown, keys: string[]) => {
    const row = configObject(input)
    if (Object.keys(row).some((key) => !keys.includes(key))) invalid()
    return row
  }
  const url = (input: unknown) => {
    if (typeof input !== 'string' || !URL.canParse(input)) return invalid()
    const parsed = new URL(input)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    )
      invalid()
    return parsed.href
  }
  const profiles: Record<string, McpAuthProfile> = {}
  const rows = configObject(value)
  if (Object.keys(rows).length > 100) invalid()
  for (const [endpoint, input] of Object.entries(rows)) {
    const key = url(endpoint)
    if (profiles[key]) invalid()
    const row = object(input, ['setupUrl', 'authorizationParams', 'device'])
    const profile: McpAuthProfile = {}
    if (row.setupUrl !== undefined) profile.setupUrl = url(row.setupUrl)
    if (row.authorizationParams !== undefined) {
      const params = object(row.authorizationParams, ['access_type', 'prompt'])
      if (
        Object.values(params).some(
          (v) =>
            typeof v !== 'string' ||
            !v ||
            v.length > 100 ||
            /[\r\n\0]/u.test(v),
        )
      )
        invalid()
      profile.authorizationParams = params as Record<string, string>
    }
    if (row.device !== undefined) {
      const device = object(row.device, [
        'authorizationUrl',
        'tokenUrl',
        'verificationUrl',
        'scopes',
        'account',
      ])
      profile.device = {
        authorizationUrl: url(device.authorizationUrl),
        tokenUrl: url(device.tokenUrl),
        verificationUrl: url(device.verificationUrl),
      }
      if (device.scopes !== undefined) {
        if (
          !Array.isArray(device.scopes) ||
          device.scopes.length > 100 ||
          device.scopes.some(
            (s) =>
              typeof s !== 'string' ||
              !s ||
              s.length > 256 ||
              /[\s\0]/u.test(s),
          )
        )
          invalid()
        profile.device.scopes = device.scopes as string[]
      }
      if (device.account !== undefined) {
        const account = object(device.account, ['url', 'nameField', 'headers'])
        if (
          typeof account.nameField !== 'string' ||
          !/^[a-zA-Z][\w-]{0,99}$/u.test(account.nameField)
        )
          invalid()
        const headers = configObject(account.headers ?? {})
        if (
          Object.keys(headers).length > 10 ||
          Object.entries(headers).some(
            ([k, v]) =>
              !/^[a-zA-Z][\w-]{0,99}$/u.test(k) ||
              /^(authorization|proxy-authorization|cookie|host)$/iu.test(k) ||
              typeof v !== 'string' ||
              v.length > 1000 ||
              /[\r\n\0]/u.test(v),
          )
        )
          invalid()
        profile.device.account = {
          url: url(account.url),
          nameField: account.nameField as string,
          headers: headers as Record<string, string>,
        }
      }
    }
    profiles[key] = profile
  }
  return profiles
}
