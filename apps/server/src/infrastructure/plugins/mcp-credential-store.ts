import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  McpCredentialRecord,
  McpCredentialStore,
} from '@oh-my-harness/agent-tools'

/** MCP 凭据独立原子持久化，连接不继承 LLM 服务商登录态。 */
export class FileMcpCredentialStore implements McpCredentialStore {
  private readonly directory: string
  private mutation: Promise<unknown> = Promise.resolve()
  constructor(dataDirectory: string) {
    this.directory = dataDirectory
  }
  private async document(): Promise<Record<string, McpCredentialRecord>> {
    try {
      const data = JSON.parse(
        await readFile(join(this.directory, 'plugin-credentials.json'), 'utf8'),
      )
      if (
        data.version !== 1 ||
        !data.connections ||
        typeof data.connections !== 'object' ||
        Array.isArray(data.connections) ||
        Object.values(data.connections).some(
          (item) =>
            !item ||
            typeof item !== 'object' ||
            typeof (item as McpCredentialRecord).binding !== 'string' ||
            typeof (item as McpCredentialRecord).generation !== 'string' ||
            typeof (item as McpCredentialRecord).settings?.allowed !==
              'boolean',
        )
      )
        throw new Error('invalid')
      return data.connections
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new Error('插件凭据文件损坏，已保留原文件')
    }
  }
  async read(id: string) {
    return (await this.document())[id]
  }
  async write(id: string, value: McpCredentialRecord | undefined) {
    const task = this.mutation.then(async () => {
      const connections = await this.document()
      if (value === undefined) delete connections[id]
      else connections[id] = value
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await chmod(this.directory, 0o700)
      const temp = join(
        this.directory,
        `.plugin-credentials-${randomUUID()}.tmp`,
      )
      const handle = await open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ version: 1, connections }))
        await handle.sync()
        await handle.close()
        await rename(temp, join(this.directory, 'plugin-credentials.json'))
      } finally {
        await handle.close().catch(() => undefined)
        await rm(temp, { force: true })
      }
    })
    this.mutation = task.catch(() => undefined)
    await task
  }
}
