import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai'
import { AUTH_METHOD } from '@oh-my-harness/shared'

interface CredentialDocument {
  credentials: Record<string, Credential>
  version: 1
}

function throwIfAborted(options?: AuthOperationOptions) {
  options?.signal?.throwIfAborted()
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== 'object') return false
  const credential = value as Record<string, unknown>
  if (credential.type === AUTH_METHOD.API_KEY) {
    return credential.key === undefined || typeof credential.key === 'string'
  }
  return (
    credential.type === AUTH_METHOD.OAUTH &&
    typeof credential.access === 'string' &&
    typeof credential.refresh === 'string' &&
    typeof credential.expires === 'number'
  )
}

function parseDocument(source: string): CredentialDocument {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Credential Store 文件损坏，已保留原文件。')
  }

  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 1
  ) {
    throw new Error('Credential Store 版本不受支持，已保留原文件。')
  }

  const credentials = (value as { credentials?: unknown }).credentials
  if (
    !credentials ||
    typeof credentials !== 'object' ||
    Array.isArray(credentials)
  ) {
    throw new Error('Credential Store 内容无效，已保留原文件。')
  }

  for (const credential of Object.values(credentials)) {
    if (!isCredential(credential)) {
      throw new Error('Credential Store 凭证内容无效，已保留原文件。')
    }
  }

  return { credentials: credentials as Record<string, Credential>, version: 1 }
}

/** 返回当前用户统一的 oh-my-harness 本地数据目录。 */
export function getDefaultDataDirectory() {
  return join(homedir(), '.omh')
}

/** LLM 包使用的版本化、本地原子文件凭证存储。 */
export class FileCredentialStore implements CredentialStore {
  readonly filePath: string
  private mutation = Promise.resolve()

  constructor(
    dataDirectory = process.env.OH_MY_HARNESS_DATA_DIR ??
      getDefaultDataDirectory(),
  ) {
    this.filePath = join(dataDirectory, 'credentials.json')
  }

  async read(providerId: string, options?: AuthOperationOptions) {
    throwIfAborted(options)
    return (await this.readDocument()).credentials[providerId]
  }

  async list(
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]> {
    throwIfAborted(options)
    const { credentials } = await this.readDocument()
    return Object.entries(credentials).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    return this.serialize(async () => {
      throwIfAborted(options)
      const document = await this.readDocument()
      const credential = await fn(document.credentials[providerId])
      throwIfAborted(options)
      if (credential !== undefined) {
        document.credentials[providerId] = credential
        await this.writeDocument(document)
      }
      return credential ?? document.credentials[providerId]
    })
  }

  async delete(providerId: string, options?: AuthOperationOptions) {
    await this.serialize(async () => {
      throwIfAborted(options)
      const document = await this.readDocument()
      if (!(providerId in document.credentials)) return
      delete document.credentials[providerId]
      await this.writeDocument(document)
    })
  }

  private async readDocument(): Promise<CredentialDocument> {
    try {
      return parseDocument(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { credentials: {}, version: 1 }
      }
      throw error
    }
  }

  private async writeDocument(document: CredentialDocument) {
    const directory = dirname(this.filePath)
    const tempPath = join(directory, `.credentials-${randomUUID()}.tmp`)
    await mkdir(directory, { mode: 0o700, recursive: true })
    if (process.platform !== 'win32') await chmod(directory, 0o700)

    const handle = await open(tempPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      await rename(tempPath, this.filePath)
      if (process.platform !== 'win32') await chmod(this.filePath, 0o600)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    // ponytail: 单文件全局串行锁适合已确认的单进程部署；出现多实例时换跨进程锁。
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
