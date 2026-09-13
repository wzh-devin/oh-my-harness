import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SkillError } from '../../error/skill-error.ts'

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
    throw new SkillError('SKILL_PATH_INVALID', '技能路径必须为相对路径')
  }
  return value
}

/** 同时验证词法路径与真实路径，防止目录及链接逃逸。 */
export async function resolveContentPath(root: string, path: string) {
  const target = resolve(root, relativePath(path))
  if (!contained(root, target))
    throw new SkillError('SKILL_PATH_ESCAPE', '技能路径越界')
  const actual = await realpath(target)
  if (!contained(await realpath(root), actual))
    throw new SkillError('SKILL_PATH_ESCAPE', '技能链接越界')
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
        throw new SkillError(
          'SKILL_BUNDLE_INVALID',
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
          throw new SkillError('SKILL_BUNDLE_TOO_LARGE', '技能包超出大小限制')
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
