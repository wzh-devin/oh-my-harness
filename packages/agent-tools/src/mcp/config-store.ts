import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  lstat,
} from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'
import {
  McpError,
  MAX_CONFIG_BYTES,
  configObject,
  parseMcpJson,
  parseMcpServer,
  publicMcpConfig,
  type McpConfigDocument,
} from './config.ts'

/** 单进程 MCP 配置事实源；文件损坏时保留原文，写入成功后才发布内存版本。 */
export class McpConfigStore {
  private document?: McpConfigDocument
  private reading?: Promise<McpConfigDocument>
  private pending = Promise.resolve()
  readonly filePath: string
  private readonly directory: string
  constructor(directory: string) {
    this.directory = directory
    this.filePath = join(directory, 'mcp.json')
  }

  async read(): Promise<McpConfigDocument> {
    if (this.document) return structuredClone(this.document)
    this.reading ??= this.load().finally(() => {
      this.reading = undefined
    })
    return structuredClone(await this.reading)
  }

  private async load(): Promise<McpConfigDocument> {
    let source: string
    try {
      const stat = await lstat(this.filePath)
      if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES)
        throw new Error('invalid file')
      source = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.document = { version: 1, revision: 0, servers: [] }
        return structuredClone(this.document)
      }
      throw new McpError(
        MCP_ERROR_CODE.CONFIG_CORRUPT,
        'MCP 配置无法读取，已保留原文件。',
        500,
      )
    }
    try {
      const value = configObject(parseMcpJson(source))
      if (
        value.version !== 1 ||
        !Number.isSafeInteger(value.revision) ||
        (value.revision as number) < 0 ||
        !Array.isArray(value.servers) ||
        value.servers.length > 100 ||
        Object.keys(value).some(
          (key) => !['version', 'revision', 'servers'].includes(key),
        )
      )
        throw new Error('invalid')
      const document = value as unknown as McpConfigDocument
      const ids = new Set<string>(),
        names = new Set<string>()
      for (const item of document.servers) {
        if (
          typeof item.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
            item.id,
          ) ||
          ids.has(item.id) ||
          names.has(item.name) ||
          !Number.isSafeInteger(item.revision) ||
          item.revision < 1
        )
          throw new Error('invalid')
        if (
          Object.keys(item).some(
            (key) =>
              ![
                'id',
                'name',
                'transport',
                'enabled',
                'revision',
                'url',
                'command',
                'args',
                'env',
                'headers',
              ].includes(key),
          )
        )
          throw new Error('invalid')
        configObject(item.env)
        configObject(item.headers)
        if (typeof item.enabled !== 'boolean') throw new Error('invalid')
        const server = parseMcpServer(item.name, {
          ...publicMcpConfig(item),
          ...(item.url ? { headers: item.headers } : { env: item.env }),
        })
        if (server.transport !== item.transport) throw new Error('invalid')
        Object.assign(item, server, { id: item.id, revision: item.revision })
        ids.add(item.id)
        names.add(item.name)
      }
      this.document = document
      return structuredClone(document)
    } catch {
      throw new McpError(
        MCP_ERROR_CODE.CONFIG_CORRUPT,
        'MCP 配置损坏或版本不受支持，已保留原文件。',
        500,
      )
    }
  }

  /** 序列化完整的检查与修改，避免两个客户端通过相同 revision 覆盖彼此。 */
  serialize<T>(operation: () => Promise<T>): Promise<T> {
    // ponytail: 单文件串行写适合单 Server；多实例部署时换跨进程锁。
    const result = this.pending.then(operation, operation)
    this.pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async write(document: McpConfigDocument) {
    const source = `${JSON.stringify(document, null, 2)}\n`
    if (Buffer.byteLength(source) > MAX_CONFIG_BYTES)
      throw new McpError(
        MCP_ERROR_CODE.INVALID_CONFIG,
        '保存后的完整配置不能超过 256 KiB。',
      )
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await chmod(this.directory, 0o700)
    const temp = join(this.directory, `.mcp-${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(source)
      await handle.sync()
      await handle.close()
      await rename(temp, this.filePath)
      this.document = structuredClone(document)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
