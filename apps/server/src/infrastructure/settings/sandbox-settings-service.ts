import {
  SANDBOX_MODE,
  isSandboxMode,
  type SandboxMode,
} from '@oh-my-harness/shared'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

interface SandboxSettingsDocument {
  mode: SandboxMode
  version: 1
}

export class SandboxSettingsError extends Error {
  readonly code: string
  readonly status: 400 | 500 | 501

  constructor(code: string, message: string, status: 400 | 500 | 501) {
    super(message)
    this.name = 'SandboxSettingsError'
    this.code = code
    this.status = status
  }
}

const parseDocument = (source: string): SandboxSettingsDocument => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new SandboxSettingsError(
      'SANDBOX_SETTINGS_INVALID',
      '沙箱配置损坏，已保留原文件。',
      500,
    )
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'mode,version' ||
    (value as { version?: unknown }).version !== 1 ||
    !isSandboxMode((value as { mode?: unknown }).mode)
  ) {
    throw new SandboxSettingsError(
      'SANDBOX_SETTINGS_INVALID',
      '沙箱配置无效，已保留原文件。',
      500,
    )
  }
  return value as SandboxSettingsDocument
}

/** 持久化全局沙箱模式，并暴露当前平台是否能真正执行该模式。 */
export class SandboxSettingsService {
  private readonly dataDirectory: string
  private readonly filePath: string
  private readonly platform: NodeJS.Platform
  private readonly sandboxExecutable: string
  private document?: SandboxSettingsDocument
  private mutation = Promise.resolve()

  constructor(
    dataDirectory: string,
    options: {
      platform?: NodeJS.Platform
      sandboxExecutable?: string
    } = {},
  ) {
    this.dataDirectory = resolve(dataDirectory)
    this.filePath = join(this.dataDirectory, 'sandbox-settings.json')
    this.platform = options.platform ?? process.platform
    this.sandboxExecutable =
      options.sandboxExecutable ?? '/usr/bin/sandbox-exec'
  }

  get supported() {
    return this.platform === 'darwin' && existsSync(this.sandboxExecutable)
  }

  async get() {
    return { mode: (await this.readDocument()).mode, supported: this.supported }
  }

  async setMode(mode: SandboxMode) {
    if (!isSandboxMode(mode)) {
      throw new SandboxSettingsError(
        'INVALID_SANDBOX_MODE',
        '沙箱模式无效。',
        400,
      )
    }
    if (!this.supported) {
      throw new SandboxSettingsError(
        'SANDBOX_UNAVAILABLE',
        '当前系统暂不支持 macOS 沙箱。',
        501,
      )
    }
    await this.serialize(async () => {
      await this.readDocument()
      const document: SandboxSettingsDocument = { mode, version: 1 }
      const tempPath = join(
        this.dataDirectory,
        `.sandbox-settings-${randomUUID()}.tmp`,
      )
      let handle: fs.FileHandle | undefined
      try {
        await fs.mkdir(this.dataDirectory, { mode: 0o700, recursive: true })
        await fs.chmod(this.dataDirectory, 0o700)
        handle = await fs.open(tempPath, 'wx', 0o600)
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        await fs.rename(tempPath, this.filePath)
        await fs.chmod(this.filePath, 0o600)
        this.document = document
      } catch {
        await handle?.close().catch(() => undefined)
        await fs.rm(tempPath, { force: true }).catch(() => undefined)
        throw new SandboxSettingsError(
          'SANDBOX_SETTINGS_PERSISTENCE_FAILED',
          '无法保存沙箱设置。',
          500,
        )
      }
    })
    return this.get()
  }

  private async readDocument(): Promise<SandboxSettingsDocument> {
    if (this.document) return this.document
    try {
      this.document = parseDocument(await fs.readFile(this.filePath, 'utf8'))
      if (this.platform !== 'win32') {
        await fs.chmod(this.dataDirectory, 0o700)
        await fs.chmod(this.filePath, 0o600)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.document = { mode: SANDBOX_MODE.READ_ONLY, version: 1 }
      } else if (error instanceof SandboxSettingsError) {
        throw error
      } else {
        throw new SandboxSettingsError(
          'SANDBOX_SETTINGS_PERSISTENCE_FAILED',
          '无法读取沙箱设置。',
          500,
        )
      }
    }
    return this.document
  }

  private async serialize<T>(operation: () => Promise<T>) {
    // ponytail: 单文件串行锁适合本地单 Server；出现多进程写入需求时再升级。
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
