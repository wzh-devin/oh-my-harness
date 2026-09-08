import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import type { StoredAttachment } from '../execution/attachment-message.ts'
import type { AgentRunAttachment } from '../execution/run-input.ts'

const safeSegment = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/u.test(value)
const safeExtension = (name: string) => {
  const extension = extname(name).toLocaleLowerCase()
  return /^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : ''
}
/** 持久化会话附件；路径和存储名只由 Runtime 生成。 */
export class AttachmentStore {
  readonly root: string

  constructor(dataDirectory: string) {
    this.root = resolve(dataDirectory, 'attachments')
  }

  sessionDirectory(sessionId: string) {
    if (!safeSegment(sessionId)) throw new Error('Invalid session ID.')
    return join(this.root, sessionId)
  }

  async save(
    sessionId: string,
    uploads: readonly AgentRunAttachment[],
  ): Promise<StoredAttachment[]> {
    if (!uploads.length) return []
    const directory = this.sessionDirectory(sessionId)
    await mkdir(directory, { mode: 0o700, recursive: true })
    await Promise.all([chmod(this.root, 0o700), chmod(directory, 0o700)])
    const stored: StoredAttachment[] = []
    try {
      for (const upload of uploads) {
        const id = randomUUID()
        const path = join(directory, `${id}${safeExtension(upload.name)}`)
        const temporary = join(directory, `.${id}.tmp`)
        try {
          await writeFile(temporary, upload.data, { flag: 'wx', mode: 0o600 })
          await chmod(temporary, 0o600)
          await rename(temporary, path)
        } finally {
          await rm(temporary, { force: true })
        }
        stored.push({
          id,
          mimeType: upload.mimeType,
          name: upload.name,
          path,
          size: upload.size,
        })
      }
      return stored
    } catch (error) {
      await Promise.allSettled(stored.map((attachment) => rm(attachment.path)))
      throw error
    }
  }

  async read(sessionId: string, attachment: StoredAttachment) {
    const directory = this.sessionDirectory(sessionId)
    const path = resolve(attachment.path)
    if (
      !safeSegment(attachment.id) ||
      path !==
        join(directory, `${attachment.id}${safeExtension(attachment.name)}`)
    ) {
      throw new Error('Invalid attachment path.')
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('Attachment is not a file.')
      return await file.readFile()
    } finally {
      await file.close()
    }
  }

  async remove(attachments: readonly StoredAttachment[]) {
    await Promise.all(attachments.map((attachment) => rm(attachment.path)))
  }

  deleteSession(sessionId: string) {
    return rm(this.sessionDirectory(sessionId), {
      force: true,
      recursive: true,
    })
  }
}
