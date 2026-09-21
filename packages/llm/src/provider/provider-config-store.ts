import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getDefaultDataDirectory } from '../auth/credential-store.ts'
import type { ProviderModelConfig } from './provider-types.ts'

interface ProviderConfigDocument {
  providers: Record<string, { models: ProviderModelConfig[] }>
  version: 1
}

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function parseDocument(source: string): ProviderConfigDocument {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Provider Config 文件损坏，已保留原文件。')
  }

  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 1
  ) {
    throw new Error('Provider Config 版本不受支持，已保留原文件。')
  }

  const providers = (value as { providers?: unknown }).providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error('Provider Config 内容无效，已保留原文件。')
  }

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!providerId.trim()) {
      throw new Error('Provider Config Provider ID 无效，已保留原文件。')
    }
    const models = (provider as { models?: unknown } | undefined)?.models
    if (
      !Array.isArray(models) ||
      models.some(
        (model) =>
          !model ||
          typeof model !== 'object' ||
          typeof (model as { id?: unknown }).id !== 'string' ||
          typeof (model as { name?: unknown }).name !== 'string' ||
          ((model as { maxOutputTokens?: unknown }).maxOutputTokens !==
            undefined &&
            !isPositiveSafeInteger(
              (model as { maxOutputTokens?: unknown }).maxOutputTokens,
            )),
      )
    ) {
      throw new Error('Provider Config 模型内容无效，已保留原文件。')
    }
    const modelIds = new Set<string>()
    for (const model of models as ProviderModelConfig[]) {
      if (
        !model.id ||
        model.id !== model.id.trim() ||
        !model.name.trim() ||
        modelIds.has(model.id)
      ) {
        throw new Error('Provider Config 模型内容无效，已保留原文件。')
      }
      modelIds.add(model.id)
    }
  }

  return {
    providers: providers as ProviderConfigDocument['providers'],
    version: 1,
  }
}

/** 保存用户显式启用的 Provider 模型，不保存任何凭证。 */
export class FileProviderConfigStore {
  readonly filePath: string
  private mutation = Promise.resolve()

  constructor(
    dataDirectory = process.env.OH_MY_HARNESS_DATA_DIR ??
      getDefaultDataDirectory(),
  ) {
    this.filePath = join(dataDirectory, 'provider-config.json')
  }

  async list() {
    return structuredClone((await this.readDocument()).providers)
  }

  async read(providerId: string) {
    return structuredClone(
      (await this.readDocument()).providers[providerId]?.models ?? [],
    )
  }

  async replace(providerId: string, models: ProviderModelConfig[]) {
    await this.serialize(async () => {
      const document = await this.readDocument()
      document.providers[providerId] = { models: structuredClone(models) }
      await this.writeDocument(document)
    })
  }

  async delete(providerId: string) {
    await this.serialize(async () => {
      const document = await this.readDocument()
      if (!(providerId in document.providers)) return
      delete document.providers[providerId]
      await this.writeDocument(document)
    })
  }

  private async readDocument(): Promise<ProviderConfigDocument> {
    try {
      return parseDocument(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { providers: {}, version: 1 }
      }
      throw error
    }
  }

  private async writeDocument(document: ProviderConfigDocument) {
    const directory = dirname(this.filePath)
    const tempPath = join(directory, `.provider-config-${randomUUID()}.tmp`)
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

  private async serialize(operation: () => Promise<void>) {
    // ponytail: 单文件全局串行锁适合已确认的单进程部署；出现多实例时换跨进程锁。
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
