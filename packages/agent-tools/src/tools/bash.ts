import { BUILTIN_TOOL_NAME } from '../tool-names.ts'
import { SANDBOX_MODE, type SandboxMode } from '@oh-my-harness/shared'
import { spawn } from 'node:child_process'

import type { AgentTool } from '@earendil-works/pi-agent-core'

export interface BashInput {
  command: string
  elevated?: true
}

export interface BashOutcome {
  exitCode: number | null
  outputExceeded: boolean
  signal: NodeJS.Signals | null
  timedOut: boolean
}

export interface BashSandboxOptions {
  mode: SandboxMode
  protectedRoots: readonly string[]
  tempDirectory: string
}

interface BashToolOptions {
  fullAccess?: boolean
  sandbox?: BashSandboxOptions
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
    elevated: {
      const: true,
      description:
        'Request one-time approval to run this command outside the active sandbox. Use only when the user request requires access blocked by the sandbox; never use it to retry a failed sandboxed command automatically.',
      type: 'boolean',
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
    Object.keys(values).some(
      (key) => key !== 'command' && key !== 'elevated',
    ) ||
    typeof values.command !== 'string' ||
    values.command.includes('\0') ||
    (values.elevated !== undefined && values.elevated !== true)
  ) {
    throw new Error('Bash input is invalid.')
  }
  const command = values.command.trim()
  if (!command || Buffer.byteLength(command) > MAX_COMMAND_BYTES) {
    throw new Error('Bash command is invalid or too large.')
  }
  return {
    command,
    ...(values.elevated === true ? { elevated: true as const } : {}),
  }
}

const commandEnvironment = () =>
  Object.fromEntries(
    environmentKeys.flatMap((key) => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )

const sbplPath = (path: string) => JSON.stringify(path)

/** 为受限 Bash 生成 macOS Seatbelt Profile；路径必须由调用方先规范化。 */
export function createMacosSandboxProfile(
  cwd: string,
  options: BashSandboxOptions,
) {
  const writableRoots = [
    options.tempDirectory,
    ...(options.mode === SANDBOX_MODE.WORKSPACE_WRITE ? [cwd] : []),
  ]
  return [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    '(allow process-exec process-fork process-info*)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow file-read*)',
    ...options.protectedRoots.map(
      (path) => `(deny file-read* (subpath ${sbplPath(path)}))`,
    ),
    `(allow file-write* (literal "/dev/null")${writableRoots
      .map((path) => ` (subpath ${sbplPath(path)})`)
      .join('')})`,
    ...(options.mode === SANDBOX_MODE.WORKSPACE_WRITE
      ? ['.git', '.agents'].map(
          (directory) =>
            `(deny file-write* (subpath ${sbplPath(`${cwd}/${directory}`)}))`,
        )
      : []),
    '(deny network*)',
  ].join('\n')
}

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
export const createBashTool = (
  cwd: string,
  options: BashToolOptions = {},
): AgentTool => ({
  description:
    'Run a complete Bash command in the workspace for builds, tests, Git, directory listing, file discovery, content search, or scripts that perform computation or format conversion. To inspect known file contents, use read, including when inspecting several files or a line range; do not batch cat/head/tail/sed reads or printing loops through bash. A targeted command fallback is allowed when read reports a content limitation; permission denials must never be bypassed. Pipes, redirections, conditionals, and multiple commands are supported for command tasks. ' +
    (options.fullAccess
      ? 'Calls are authorized by the full-access run policy and run outside the active sandbox.'
      : options.sandbox
        ? 'Every call requires user approval and runs inside the active sandbox by default. Set elevated to true only when the user request requires access outside that boundary; elevation requires separate one-time approval and must not be used to retry a sandbox failure automatically.'
        : 'Every call requires user approval.'),
  label: 'bash',
  name: BUILTIN_TOOL_NAME.BASH,
  parameters,
  async execute(_toolCallId, input, signal) {
    signal?.throwIfAborted()
    const { command, elevated } = parseBashInput(input)
    const restricted =
      process.platform === 'darwin' &&
      options.sandbox &&
      options.sandbox.mode !== SANDBOX_MODE.DANGER_FULL_ACCESS &&
      !options.fullAccess &&
      !elevated
    const executable = restricted ? '/usr/bin/sandbox-exec' : 'bash'
    const arguments_ = restricted
      ? [
          '-p',
          createMacosSandboxProfile(cwd, options.sandbox!),
          '/bin/bash',
          '-c',
          command,
        ]
      : ['-c', command]
    return new Promise((resolve, reject) => {
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let aborted = false
      let outputExceeded = false
      let outputSize = 0
      let settled = false
      let timedOut = false
      const child = spawn(executable, arguments_, {
        cwd,
        detached: process.platform !== 'win32',
        env: {
          ...commandEnvironment(),
          ...(restricted
            ? {
                TEMP: options.sandbox!.tempDirectory,
                TMP: options.sandbox!.tempDirectory,
                TMPDIR: options.sandbox!.tempDirectory,
              }
            : {}),
        },
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
        fail(
          new Error(
            restricted
              ? 'macOS sandbox is unavailable.'
              : 'Bash is unavailable.',
            { cause: error },
          ),
        ),
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
