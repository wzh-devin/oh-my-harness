import { spawn } from 'node:child_process'
import type { PluginHook } from '../manifest/manifest.ts'

/** 已授权命令的单次运行；输入和输出有限，超时结束整个进程组。 */
export const runPluginHook = async (
  hook: PluginHook,
  root: string,
  data: string,
  cwd: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> => {
  const child = spawn('/bin/sh', ['-c', hook.command], {
    cwd,
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: data,
      PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_ROOT: root,
      PLUGIN_DATA: data,
      CLAUDE_PLUGIN_DATA: data,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stop = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }
  const timer = setTimeout(stop, hook.timeout * 1000)
  const onAbort = () => stop()
  signal.addEventListener('abort', onAbort, { once: true })
  const output: Buffer[] = []
  let size = 0
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > 64 * 1024) stop()
    else output.push(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > 64 * 1024) stop()
  })
  child.stdin.end(JSON.stringify(input))
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? -1))
    })
    if (code !== 0 || signal.aborted || size > 64 * 1024)
      throw new Error('Hook 命令未成功完成。')
    const raw = Buffer.concat(output).toString('utf8').trim()
    if (!raw) return ''
    let context = raw
    if (raw.startsWith('{')) {
      const value = JSON.parse(raw) as Record<string, unknown>
      const specific = value.hookSpecificOutput as
        Record<string, unknown> | undefined
      if (specific?.hookEventName && specific.hookEventName !== hook.event)
        throw new Error('Hook 输出事件不匹配。')
      const declared =
        specific?.additionalContext ?? value.additionalContext ?? ''
      if (typeof declared !== 'string') throw new Error('Hook 输出内容无效。')
      context = declared
    }
    if (context.length > 8192) throw new Error('Hook 输出过长。')
    return context
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (child.exitCode === null) stop()
  }
}
