import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { createReadTool, type AgentTool } from '@earendil-works/pi-agent-core'

export interface SkillResourceRoot {
  id: string
  rootDirectory: string
  resourceRootDirectory?: string
}

const MAX_RESOURCE_BYTES = 256 * 1024

const isWithin = (root: string, path: string) => {
  const child = relative(root, path)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

const imageMimeType = (bytes: Uint8Array) => {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  const header = Buffer.from(bytes.subarray(0, 12)).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}

/** 创建只能读取已发现 Skill 自身目录的只读资源工具。 */
export const createSkillResourceTool = (
  roots: readonly SkillResourceRoot[],
): AgentTool => {
  const schema = createReadTool()
  const rootById = new Map(roots.map((root) => [root.id, root]))
  return {
    ...schema,
    description:
      'Read a file owned by an available skill. Use path "<skill-id>/<relative-path>"; use SKILL.md for the skill instructions.',
    label: 'load skill resource',
    name: 'load_skill_resource',
    async execute(
      _toolCallId: string,
      parameters: unknown,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted()
      if (
        !parameters ||
        typeof parameters !== 'object' ||
        Array.isArray(parameters) ||
        typeof (parameters as Record<string, unknown>).path !== 'string'
      ) {
        throw new Error('Skill resource path is invalid.')
      }
      const path = (parameters as { path: string }).path
      const separator = path.indexOf('/')
      const id = separator === -1 ? path : path.slice(0, separator)
      const resourcePath =
        separator === -1 ? 'SKILL.md' : path.slice(separator + 1)
      const root = rootById.get(id)
      if (
        !root ||
        !resourcePath ||
        resourcePath.includes('\0') ||
        isAbsolute(resourcePath) ||
        (!root.resourceRootDirectory &&
          resourcePath.split(/[\\/]/u).includes('..'))
      ) {
        throw new Error('Skill resource path is invalid.')
      }

      const canonicalRoot = await realpath(root.rootDirectory).catch(
        () => undefined,
      )
      const boundary = await realpath(
        root.resourceRootDirectory ?? root.rootDirectory,
      ).catch(() => undefined)
      if (!canonicalRoot) throw new Error('Skill resource is unavailable.')
      const target = await realpath(resolve(canonicalRoot, resourcePath)).catch(
        () => undefined,
      )
      if (
        !boundary ||
        !target ||
        !isWithin(boundary, canonicalRoot) ||
        !isWithin(boundary, target)
      ) {
        throw new Error('Skill resource is unavailable.')
      }
      const info = await stat(target).catch(() => undefined)
      if (!info) throw new Error('Skill resource is unavailable.')
      if (!info.isFile() || info.size > MAX_RESOURCE_BYTES) {
        throw new Error('Skill resource is unavailable or too large.')
      }
      const bytes = await readFile(target).catch(() => undefined)
      if (!bytes) throw new Error('Skill resource is unavailable.')
      signal?.throwIfAborted()
      const mimeType = imageMimeType(bytes)
      if (mimeType) {
        return {
          content: [
            { text: `Read skill image [${mimeType}]`, type: 'text' },
            { data: bytes.toString('base64'), mimeType, type: 'image' },
          ],
          details: undefined,
        }
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) throw new Error('Skill resource is not text.')
      return {
        content: [{ text, type: 'text' }],
        details: undefined,
      }
    },
  }
}
