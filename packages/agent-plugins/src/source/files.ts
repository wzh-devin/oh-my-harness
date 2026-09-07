import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PluginError } from '../manifest/types.ts'

export const MAX_FILES = 20_000
export const MAX_BYTES = 256 * 1024 * 1024
export const MAX_FILE_BYTES = 16 * 1024 * 1024

/** 判断规范化目标是否仍在内容根目录内。 */
export function contained(root: string, target: string) {
  const path = relative(root, target)
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}

/** 拒绝绝对路径、平台前缀和非法字符。 */
export function relativePath(value: string) {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    /^[a-z]:/i.test(value)
  ) {
    throw new PluginError('PLUGIN_PATH_INVALID', '插件路径必须为相对路径')
  }
  return value
}

/** 同时验证词法路径与真实路径，防止目录及链接逃逸。 */
export async function resolveContentPath(root: string, path: string) {
  const target = resolve(root, relativePath(path))
  if (!contained(root, target))
    throw new PluginError('PLUGIN_PATH_ESCAPE', '插件路径越界')
  const actual = await realpath(target)
  if (!contained(await realpath(root), actual))
    throw new PluginError('PLUGIN_PATH_ESCAPE', '插件链接越界')
  return actual
}

/** 仅将文件不存在视为 false，其他文件系统异常继续抛出。 */
export async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** 检查包大小与文件类型，并对完整资源树生成版本摘要。 */
export async function inspectTree(root: string) {
  const hash = createHash('sha256')
  let count = 0
  let bytes = 0
  async function walk(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      if (name === '.git') continue
      const path = join(directory, name)
      const stat = await lstat(path)
      if (
        ++count > MAX_FILES ||
        stat.isSymbolicLink() ||
        (!stat.isFile() && !stat.isDirectory())
      ) {
        throw new PluginError(
          'PLUGIN_BUNDLE_INVALID',
          '包包含链接、特殊文件或过多文件',
        )
      }
      hash.update(relative(root, path)).update('\0')
      if (stat.isDirectory()) {
        hash.update('directory\0')
        await walk(path)
      } else {
        bytes += stat.size
        if (stat.size > MAX_FILE_BYTES || bytes > MAX_BYTES)
          throw new PluginError('PLUGIN_BUNDLE_TOO_LARGE', '插件包超出大小限制')
        hash
          .update('file\0')
          .update(String(stat.size))
          .update('\0')
          .update(await readFile(path))
      }
    }
  }
  await walk(root)
  return hash.digest('hex')
}

/** 在清单边界拒绝非对象输入。 */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PluginError('PLUGIN_MANIFEST_INVALID', '清单必须是 JSON 对象')
  return value as Record<string, unknown>
}

/** 在内容边界内读取限长 JSON 清单。 */
export async function readJson(root: string, path: string) {
  const file = await resolveContentPath(root, path)
  if ((await lstat(file)).size > 1024 * 1024)
    throw new PluginError('PLUGIN_MANIFEST_TOO_LARGE', '清单过大')
  try {
    return object(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (error instanceof PluginError) throw error
    throw new PluginError('PLUGIN_MANIFEST_INVALID', '无法解析 JSON 清单')
  }
}
