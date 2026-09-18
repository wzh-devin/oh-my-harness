import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveContentPath } from './files.ts'

export const MAX_ICON_BYTES = 1024 * 1024
/** 按文件签名识别允许展示的栅格图片，不信任扩展名。 */
export const iconMime = (bytes: Buffer) =>
  bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ? { ext: 'png', mime: 'image/png' }
    : bytes.length >= 3 &&
        bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      ? { ext: 'jpg', mime: 'image/jpeg' }
      : bytes.length >= 12 &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP'
        ? { ext: 'webp', mime: 'image/webp' }
        : undefined

/** 市场和已安装插件共用图片读取边界；无效的可选资源不影响插件能力。 */
export const readPluginIcon = async (root: string, declared: unknown) => {
  try {
    if (typeof declared !== 'string' || !declared.startsWith('./')) return
    const parts = declared.slice(2).split('/')
    if (
      parts.some((part) => !part || part === '.' || part === '..') ||
      declared.includes('\\')
    )
      return
    let current = root
    for (const part of parts) {
      current = join(current, part)
      if ((await lstat(current)).isSymbolicLink()) return
    }
    const path = await resolveContentPath(root, declared)
    const info = await lstat(path)
    if (!info.isFile() || info.size > MAX_ICON_BYTES) return
    const bytes = await readFile(path)
    const type = iconMime(bytes)
    if (!type || bytes.length > MAX_ICON_BYTES) return
    return { bytes, ...type }
  } catch {
    return undefined
  }
}
