import { spawn } from 'node:child_process'

import type { AgentTool } from '@earendil-works/pi-agent-core'

export interface BashInput {
  command: string
}

export interface BashOutcome {
  exitCode: number | null
  outputExceeded: boolean
  signal: NodeJS.Signals | null
  timedOut: boolean
}

const MAX_COMMAND_BYTES = 32 * 1024
const MAX_OUTPUT_BYTES = 256 * 1024
const TIMEOUT_MS = 60_000
const environmentKeys = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
] as const

const parameters = {
  additionalProperties: false,
  properties: {
    command: {
      description:
        'A complete Bash command. Pipes, redirections, conditionals, and multiple commands are supported.',
      maxLength: MAX_COMMAND_BYTES,
      minLength: 1,
      type: 'string',
    },
  },
  required: ['command'],
  type: 'object',
} as unknown as AgentTool['parameters']

/** 同时供审批和执行使用，避免两处命令边界发生偏差。 */
export function parseBashInput(input: unknown): BashInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Bash input is invalid.')
  }
  const values = input as Record<string, unknown>
  if (
    Object.keys(values).some((key) => key !== 'command') ||
    typeof values.command !== 'string' ||
    values.command.includes('\0')
  ) {
    throw new Error('Bash input is invalid.')
  }
  const command = values.command.trim()
  if (!command || Buffer.byteLength(command) > MAX_COMMAND_BYTES) {
    throw new Error('Bash command is invalid or too large.')
  }
  return { command }
}

const commandEnvironment = () =>
  Object.fromEntries(
    environmentKeys.flatMap((key) => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )

const resultText = (
  stdout: Buffer[],
  stderr: Buffer[],
  outcome: BashOutcome,
) => {
  const text = [
    Buffer.concat(stdout).toString('utf8'),
    Buffer.concat(stderr).length
      ? `[stderr]\n${Buffer.concat(stderr).toString('utf8')}`
      : '',
  ].filter(Boolean)
  if (outcome.outputExceeded) {
    text.push('[output exceeded 256 KiB]')
  } else if (outcome.timedOut) {
    text.push('[timed out after 60000ms]')
  } else if (outcome.signal) {
    text.push(`[killed by signal: ${outcome.signal}]`)
  } else if (outcome.exitCode !== 0) {
    text.push(`[exit code: ${outcome.exitCode ?? 'unknown'}]`)
  }
  return text.join('\n') || '(no output)'
}

/** 在固定工作区中执行一条完整 Bash 命令；审批由本轮 Policy 决定。 */
export const createBashTool = (cwd: string, fullAccess = false): AgentTool => ({
  description:
    'Run a complete Bash command in the workspace. Pipes, redirections, conditionals, and multiple commands are supported. ' +
    (fullAccess
      ? 'Calls are authorized by the full-access run policy.'
      : 'Every call requires user approval.'),
  label: 'bash',
  name: 'bash',
  parameters,
  async execute(_toolCallId, input, signal) {
    signal?.throwIfAborted()
    const { command } = parseBashInput(input)
    return new Promise((resolve, reject) => {
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let aborted = false
      let outputExceeded = false
      let outputSize = 0
      let settled = false
      let timedOut = false
      const child = spawn('bash', ['-c', command], {
        cwd,
        detached: process.platform !== 'win32',
        env: commandEnvironment(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const stop = () => {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
            return
          } catch {
            // 子进程可能已先退出；继续尝试直接终止句柄。
          }
        }
        child.kill('SIGKILL')
      }
      const collect = (target: Buffer[], chunk: Buffer) => {
        if (outputExceeded) return
        const remaining = MAX_OUTPUT_BYTES - outputSize
        if (chunk.byteLength > remaining) {
          if (remaining > 0) target.push(chunk.subarray(0, remaining))
          outputSize = MAX_OUTPUT_BYTES
          outputExceeded = true
          stop()
          return
        }
        outputSize += chunk.byteLength
        target.push(chunk)
      }
      const onAbort = () => {
        aborted = true
        stop()
      }
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, TIMEOUT_MS)

      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
      child.once('error', (error) =>
        fail(new Error('Bash is unavailable.', { cause: error })),
      )
      child.once('close', (exitCode, childSignal) => {
        if (aborted) return fail(new Error('Bash command aborted.'))
        if (settled) return
        settled = true
        cleanup()
        const outcome: BashOutcome = {
          exitCode,
          outputExceeded,
          signal: childSignal,
          timedOut,
        }
        resolve({
          content: [
            { text: resultText(stdout, stderr, outcome), type: 'text' },
          ],
          details: outcome,
        })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  },
})
