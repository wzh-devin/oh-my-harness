import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable, Transform } from 'node:stream'

const denied = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(address, prefix)

/** 仅允许 HTTPS 和用户显式信任的本地回环地址。 */
export function validateMcpUrl(value: string, loopbackOrigin?: string) {
  const url = new URL(value)
  const local =
    loopbackOrigin === url.origin &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (!local && url.protocol !== 'https:') ||
    (local && !['http:', 'https:'].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('MCP 地址必须为 HTTPS；仅显式配置的 loopback 可使用 HTTP')
  return url
}

/** 将已校验 DNS 地址绑定到套接字，不跟随可能携带凭据的重定向。 */
export function createMcpFetch(loopbackOrigin?: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init)
    const url = validateMcpUrl(req.url, loopbackOrigin)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true })
    const local =
      url.origin === loopbackOrigin &&
      ['localhost', '127.0.0.1', '::1'].includes(host)
    if (
      !addresses.length ||
      addresses.some(({ address, family }) =>
        family === 4
          ? denied.check(address) && !(local && address.startsWith('127.'))
          : !(local && address === '::1') && !/^[23][\da-f]{3}:/i.test(address),
      )
    )
      throw new Error('MCP 网络目标不允许访问私有或保留地址')
    const address = addresses[0]
    const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined
    if (body && body.length > 2 * 1024 * 1024) throw new Error('MCP 请求过大')
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(60_000)])
    return new Promise<Response>((resolve, reject) => {
      const socket = (url.protocol === 'http:' ? httpRequest : httpsRequest)(
        url,
        {
          method: req.method,
          headers: Object.fromEntries(req.headers),
          signal,
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [address])
            else callback(null, address.address, address.family)
          },
        },
        (response) => {
          const status = response.statusCode ?? 500
          if (status >= 300 && status < 400) {
            response.destroy()
            reject(new Error('MCP 不自动跟随重定向'))
            return
          }
          const headers = new Headers()
          for (const [key, value] of Object.entries(response.headers))
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          if ([204, 205, 304].includes(status) || req.method === 'HEAD') {
            response.resume()
            resolve(new Response(null, { status, headers }))
            return
          }
          let bytes = 0
          const limit = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              bytes += chunk.length
              done(
                bytes > 8 * 1024 * 1024 ? new Error('MCP 响应过大') : null,
                chunk,
              )
            },
          })
          response.on('error', (error) => limit.destroy(error))
          limit.on('close', () => response.destroy())
          response.pipe(limit)
          resolve(
            new Response(Readable.toWeb(limit) as ReadableStream<Uint8Array>, {
              status,
              headers,
            }),
          )
        },
      )
      socket.on('error', reject)
      socket.end(body)
    })
  }
}
