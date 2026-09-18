import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MCP_ERROR_CODE } from '@oh-my-harness/shared'
import { McpError } from './config.ts'
export const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
const MAX_STATE_BYTES = 8 * 1024 * 1024
/** 数据目录不能是链接；状态和内容只由当前系统用户访问。 */
export const privateDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new McpError(
      MCP_ERROR_CODE.CONFIG_CORRUPT,
      'MCP 授权数据目录无效。',
      500,
    )
  await chmod(directory, 0o700)
}

/** 完整写入并同步临时文件后原子发布，失败时不覆盖已有文档。 */
export const atomicJson = async (
  directory: string,
  name: string,
  value: unknown,
) => {
  const source = JSON.stringify(value)
  if (Buffer.byteLength(source) > MAX_STATE_BYTES)
    throw new McpError(
      MCP_ERROR_CODE.INVALID_CONFIG,
      'MCP 授权数据超过存储限制。',
    )
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(source)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, join(directory, name))
  } finally {
    await rm(temporary, { force: true })
  }
}

/** 有限读取 JSON；未知文件错误必须保留并上报。 */
export const readJson = async (path: string): Promise<unknown> => {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES)
    throw new McpError(
      MCP_ERROR_CODE.CONFIG_CORRUPT,
      'MCP 授权数据文件无效。',
      500,
    )
  return JSON.parse(await readFile(path, 'utf8'))
}
