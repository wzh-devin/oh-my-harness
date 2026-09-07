import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { promisify } from 'node:util'
import yauzl from 'yauzl'
import type { PluginSource } from '../manifest/types.ts'
import { PluginError } from '../manifest/types.ts'
import {
  contained,
  inspectTree,
  MAX_BYTES,
  MAX_FILES,
  MAX_FILE_BYTES,
  relativePath,
} from './files.ts'

const exec = promisify(execFile)

export function normalizeGitSource(
  input: string,
  allowedHosts: string[] = ['github.com', 'gitlab.com', 'bitbucket.org'],
): Extract<PluginSource, { type: 'git' }> {
  const value = /^[\w.-]+\/[\w.-]+$/.test(input)
    ? `https://github.com/${input}.git`
    : input
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PluginError(
      'PLUGIN_SOURCE_INVALID',
      '请输入 Git HTTPS 地址或 owner/repo',
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !allowedHosts.includes(url.hostname)
  ) {
    throw new PluginError(
      'PLUGIN_SOURCE_INVALID',
      'Git 来源必须是受信任主机的 HTTPS 地址，且不含凭据',
    )
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (
    url.hostname === 'github.com' &&
    parts[2] === 'tree' &&
    parts.length >= 4
  ) {
    return {
      type: 'git',
      url: `https://github.com/${parts[0]}/${parts[1]}.git`,
      ref: decodeURIComponent(parts[3]),
      path: parts.slice(4).map(decodeURIComponent).join('/') || '.',
    }
  }
  return { type: 'git', url: url.href }
}

export async function fetchGit(
  source: Extract<PluginSource, { type: 'git' }>,
  destination: string,
  signal: AbortSignal,
  allowedHosts?: string[],
) {
  normalizeGitSource(source.url, allowedHosts)
  if (
    source.ref &&
    (!/^[\w./-]{1,200}$/.test(source.ref) || source.ref.startsWith('-'))
  )
    throw new PluginError('PLUGIN_REF_INVALID', '无效 Git ref')
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const env = {
    PATH: process.env.PATH,
    HOME: destination,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  }
  // Monitor the clone, including .git, so limits also apply before checkout finishes.
  let inspecting = false
  const timer = setInterval(async () => {
    if (inspecting) return
    inspecting = true
    try {
      let bytes = 0
      let count = 0
      async function walk(dir: string) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (++count > MAX_FILES * 2) throw new Error('limit')
          const path = join(dir, entry.name)
          if (entry.isDirectory()) await walk(path)
          else if ((bytes += (await stat(path)).size) > MAX_BYTES * 2)
            throw new Error('limit')
        }
      }
      await walk(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') controller.abort()
    } finally {
      inspecting = false
    }
  }, 250)
  try {
    const pinned = source.ref && /^[a-f0-9]{40}$/i.test(source.ref)
    await exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'http.followRedirects=false',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        'clone',
        '--depth=1',
        '--no-recurse-submodules',
        ...(pinned
          ? ['--no-checkout']
          : source.ref
            ? ['--branch', source.ref]
            : []),
        '--',
        source.url,
        destination,
      ],
      { env, signal: combined, timeout: 120_000, maxBuffer: 64 * 1024 },
    )
    if (pinned) {
      await exec(
        'git',
        [
          '-C',
          destination,
          '-c',
          'http.followRedirects=false',
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.https.allow=always',
          'fetch',
          '--depth=1',
          'origin',
          source.ref!,
        ],
        { env, signal: combined, timeout: 120_000, maxBuffer: 64 * 1024 },
      )
      await exec(
        'git',
        [
          '-C',
          destination,
          '-c',
          'core.hooksPath=/dev/null',
          'checkout',
          '--detach',
          'FETCH_HEAD',
        ],
        { env, signal: combined, timeout: 30_000, maxBuffer: 64 * 1024 },
      )
    }
    const result = await exec('git', ['-C', destination, 'rev-parse', 'HEAD'], {
      env,
      signal: combined,
      timeout: 5_000,
    })
    await inspectTree(destination)
    return result.stdout.trim()
  } catch {
    throw new PluginError(
      'PLUGIN_FETCH_FAILED',
      signal.aborted
        ? '导入已取消'
        : 'Git 获取失败，请检查来源、分支、网络或包大小',
    )
  } finally {
    clearInterval(timer)
  }
}

export async function extractZip(
  bytes: Buffer,
  destination: string,
  signal: AbortSignal,
) {
  if (bytes.length > 64 * 1024 * 1024)
    throw new PluginError('PLUGIN_ZIP_TOO_LARGE', 'ZIP 不能超过 64 MiB')
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : resolve(file!)),
    ),
  )
  let total = 0
  const names = new Set<string>()
  let entryWork: Promise<void> | undefined
  let abort: (() => void) | undefined
  try {
    await new Promise<void>((done, fail) => {
      abort = () =>
        fail(new PluginError('PLUGIN_IMPORT_CANCELLED', '导入已取消'))
      signal.addEventListener('abort', abort, { once: true })
      zip.once('error', fail)
      zip.once('end', () => {
        signal.removeEventListener('abort', abort!)
        done()
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        entryWork = (async () => {
          signal.throwIfAborted()
          const name = relativePath(entry.fileName)
          const target = resolve(destination, name)
          const key = target.normalize('NFC').toLowerCase()
          const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
          if (
            !contained(destination, target) ||
            target === destination ||
            names.has(key) ||
            names.size >= MAX_FILES ||
            (fileType && fileType !== 0o100000 && fileType !== 0o040000) ||
            entry.isEncrypted()
          )
            throw new PluginError(
              'PLUGIN_ZIP_INVALID',
              'ZIP 包含越界路径、重复文件、链接或加密内容',
            )
          names.add(key)
          if (name.endsWith('/')) {
            await mkdir(target, { recursive: true, mode: 0o700 })
            zip.readEntry()
            return
          }
          if (
            entry.uncompressedSize > MAX_FILE_BYTES ||
            entry.uncompressedSize >
              Math.max(entry.compressedSize * 200, 1024 * 1024)
          )
            throw new PluginError(
              'PLUGIN_ZIP_TOO_LARGE',
              'ZIP 条目超出解压限制',
            )
          await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 })
          const input = await new Promise<NodeJS.ReadableStream>(
            (resolve, reject) =>
              zip.openReadStream(entry, (error, stream) =>
                error ? reject(error) : resolve(stream!),
              ),
          )
          let size = 0
          const guard = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              total += chunk.length
              size += chunk.length
              callback(
                total > MAX_BYTES || size > MAX_FILE_BYTES
                  ? new PluginError('PLUGIN_ZIP_TOO_LARGE', 'ZIP 超出解压限制')
                  : null,
                chunk,
              )
            },
          })
          await pipeline(
            input,
            guard,
            createWriteStream(target, { flags: 'wx', mode: 0o600 }),
            { signal },
          )
          await chmod(target, 0o600)
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    })
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
    await entryWork
    zip.close()
  }
}
