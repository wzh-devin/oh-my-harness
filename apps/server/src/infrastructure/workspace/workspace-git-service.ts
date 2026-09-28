import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  GIT_ACTION,
  GIT_ERROR_CODE,
  GIT_FILE_STATUS,
  GIT_REPOSITORY_STATE,
  type GitFileStatus,
} from '@oh-my-harness/shared'
import type {
  GitActionDto,
  GitFileDto,
  WorkspaceGitDto,
} from '../../dto/workspace/workspace-git-dto.ts'
import { WorkspaceError, type WorkspaceStore } from './workspace-store.ts'

const exec = promisify(execFile)
const MAX_FILES = 2000
const MAX_OUTPUT = 2 * 1024 * 1024
const emptySnapshot = (): WorkspaceGitDto => ({
  state: GIT_REPOSITORY_STATE.NOT_REPOSITORY,
  revision: '',
  branch: null,
  head: null,
  upstream: null,
  compareUrl: null,
  ahead: 0,
  behind: 0,
  additions: 0,
  deletions: 0,
  operationInProgress: false,
  files: [],
  branches: [],
  actions: [],
})
const fail = (
  message: string,
  code: string = GIT_ERROR_CODE.ACTION_UNAVAILABLE,
): never => {
  throw new WorkspaceError(code, message, 409)
}

type GitCommandFailure = {
  code?: number | string
  stdout?: string
  stderr?: string
  killed?: boolean
}

// 按优先级取首个匹配；只返回固定文案，避免泄露 stderr 中的远端凭据。
const gitErrorRules = [
  {
    pattern: /Author identity unknown|unable to auto-detect email/,
    message: '请先在 Git 中配置提交者姓名和邮箱。',
  },
  {
    pattern: /index.lock|another git process/i,
    message: '仓库正在被其他 Git 操作使用，请稍后重试。',
  },
  {
    pattern: /non-fast-forward|fetch first|rejected/i,
    message: '推送被拒绝，请先在本地同步远端分支。',
  },
  {
    pattern: /Authentication|Permission denied|could not read Username/i,
    message: 'Git 认证失败，请在本地检查远端凭据。',
  },
  {
    pattern: /would be overwritten|local changes/i,
    message: '本地修改阻止了操作，请先处理修改。',
  },
]

export const getGitErrorMessage = (failure: GitCommandFailure): string => {
  if (failure.code === 'ENOENT') return '未安装 Git。'
  if (failure.killed) return 'Git 操作超时，请刷新状态后重试。'
  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return 'Git 输出过大，请使用本地 Git 工具处理。'
  const stderr = failure.stderr ?? ''
  return (
    gitErrorRules.find(({ pattern }) => pattern.test(stderr))?.message ??
    'Git 操作失败，请在本地检查仓库后重试。'
  )
}

/** 使用固定参数执行 Git，禁用交互与外部差异驱动，避免继承 Git 目录覆盖变量。 */
const runGit = async (
  cwd: string,
  args: string[],
  allowedExitCodes: number[] = [],
) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  )
  try {
    return (
      await exec(
        'git',
        [
          '--no-pager',
          '--literal-pathspecs',
          '-c',
          'core.quotepath=false',
          ...args,
        ],
        {
          cwd,
          env: {
            ...env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_OPTIONAL_LOCKS: '0',
            LC_ALL: 'C',
          },
          encoding: 'utf8',
          timeout: args[0] === 'push' ? 60_000 : 15_000,
          maxBuffer: MAX_OUTPUT,
        },
      )
    ).stdout
  } catch (error) {
    const failure = error as GitCommandFailure
    const stderr = failure.stderr ?? ''
    const expectedAbsence = args.includes('--show-toplevel')
      ? /not a git repository|must be run in a work tree/i.test(stderr)
      : /Needed a single revision|unknown revision|no upstream configured|no such branch|upstream branch .* not stored/i.test(
          stderr,
        )
    if (
      (failure.code !== 128 || expectedAbsence) &&
      typeof failure.code === 'number' &&
      allowedExitCodes.includes(failure.code)
    )
      return failure.stdout ?? ''
    throw new WorkspaceError(
      GIT_ERROR_CODE.UNAVAILABLE,
      getGitErrorMessage(failure),
      409,
    )
  }
}

/** 解析 NUL 分隔的 Git 状态，保留含空格、换行及重命名的真实路径。 */
export const parseGitFiles = (source: string): GitFileDto[] => {
  const records = source.split('\0')
  const files: GitFileDto[] = []
  const knownStatusSet = new Set<string>(Object.values(GIT_FILE_STATUS))
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record) continue
    const x = record[0],
      y = record[1]
    if (!knownStatusSet.has(x) || !knownStatusSet.has(y) || record[2] !== ' ') {
      fail('无法识别 Git 状态。', GIT_ERROR_CODE.UNAVAILABLE)
    }
    const renamed = [x, y].some(
      (value) =>
        value === GIT_FILE_STATUS.RENAMED || value === GIT_FILE_STATUS.COPIED,
    )
    files.push({
      path: record.slice(3),
      ...(renamed ? { originalPath: records[++index] } : {}),
      indexStatus: x as GitFileStatus,
      worktreeStatus: y as GitFileStatus,
      conflicted:
        x === GIT_FILE_STATUS.UNMERGED ||
        y === GIT_FILE_STATUS.UNMERGED ||
        (x === GIT_FILE_STATUS.ADDED && y === GIT_FILE_STATUS.ADDED) ||
        (x === GIT_FILE_STATUS.DELETED && y === GIT_FILE_STATUS.DELETED),
    })
  }
  if (files.length > MAX_FILES)
    fail(
      '变更文件超过 2000 个，请使用本地 Git 工具处理。',
      GIT_ERROR_CODE.LIMIT_EXCEEDED,
    )
  return files
}

/** 只返回 GitHub 比较页；原始远端配置（可能含凭据）始终留在服务端。 */
export const getGitHubCompareUrl = (config: string, branch: string | null) => {
  if (!branch) return null
  const entries = new Map<string, string>()
  for (const record of config.split('\0')) {
    const separator = record.indexOf('\n')
    if (separator < 0) continue
    const key = record.slice(0, separator)
    if (!entries.has(key)) entries.set(key, record.slice(separator + 1))
  }
  const remotes = [...entries.keys()]
    .filter((key) => key.startsWith('remote.') && key.endsWith('.url'))
    .map((key) => key.slice(7, -4))
  const remote =
    entries.get(`branch.${branch}.remote`) ??
    (remotes.includes('origin')
      ? 'origin'
      : remotes.length === 1
        ? remotes[0]
        : '')
  const address = entries.get(`remote.${remote}.url`)
  if (!address || remote === '.' || /\s/.test(address)) return null
  try {
    const url = new URL(
      address.replace(/^(?:git@)?github\.com:/i, 'ssh://git@github.com/'),
    )
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) ||
      url.search ||
      url.hash
    )
      return null
    const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '')
    if (!/^\/[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(path)) return null
    if (['.', '..'].includes(path.split('/')[2])) return null
    return `https://github.com${path}/compare/${encodeURIComponent(branch)}`
  } catch {
    return null
  }
}

/** 从注册工作区读取 Git 事实，按仓库串行写入并拒绝已过期的 UI 操作。 */
export class WorkspaceGitService {
  private readonly workspaces: WorkspaceStore
  private readonly mutations = new Map<string, Promise<unknown>>()
  constructor(workspaces: WorkspaceStore) {
    this.workspaces = workspaces
  }

  private async root(workspaceId: string) {
    const workspace = await this.workspaces.requireAvailable(workspaceId)
    const root = await runGit(
      workspace.path,
      ['rev-parse', '--show-toplevel'],
      [128],
    )
    if (!root.trim()) return null
    if ((await realpath(root.trim())) !== (await realpath(workspace.path))) {
      fail('请将 Git 仓库根目录注册为工作区后操作。')
    }
    return workspace.path
  }

  async snapshot(workspaceId: string) {
    const root = await this.root(workspaceId)
    return root ? this.readSnapshot(root) : emptySnapshot()
  }

  private async readSnapshot(root: string): Promise<WorkspaceGitDto> {
    const [
      rawStatus,
      headValue,
      branchValue,
      refs,
      indexEntries,
      numstat,
      gitDirectory,
      remoteConfig,
    ] = await Promise.all([
      runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      runGit(root, ['rev-parse', '--verify', 'HEAD'], [128]),
      runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [1]),
      runGit(root, [
        'for-each-ref',
        '--format=%(refname)%09%(symref)',
        'refs/heads',
        'refs/remotes',
      ]),
      runGit(root, ['ls-files', '--stage', '-z']),
      // 两个暂存层分别统计；不会把未知的未跟踪文件伪装成零行变更。
      runGit(root, [
        'diff',
        '--numstat',
        '-z',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
      ]),
      runGit(root, ['rev-parse', '--absolute-git-dir']),
      runGit(
        root,
        [
          'config',
          '--null',
          '--get-regexp',
          '^(remote\\..*\\.url|branch\\..*\\.remote)$',
        ],
        [1],
      ),
    ])
    const files = parseGitFiles(rawStatus)
    const head = headValue.trim() || null
    const branch = branchValue.trim() || null
    const compareUrl = head ? getGitHubCompareUrl(remoteConfig, branch) : null
    const [stagedNumstat, upstreamValue, operations, fileVersions] =
      await Promise.all([
        runGit(root, [
          'diff',
          '--cached',
          '--numstat',
          '-z',
          '--no-renames',
          '--no-ext-diff',
          '--no-textconv',
        ]),
        branch && head
          ? runGit(
              root,
              [
                'rev-parse',
                '--abbrev-ref',
                '--symbolic-full-name',
                '@{upstream}',
              ],
              [128],
            )
          : '',
        Promise.all(
          [
            'MERGE_HEAD',
            'CHERRY_PICK_HEAD',
            'REVERT_HEAD',
            'rebase-merge',
            'rebase-apply',
            'sequencer',
          ].map(
            async (name) =>
              !!(await lstat(join(gitDirectory.trim(), name)).catch(
                () => null,
              )),
          ),
        ),
        Promise.all(
          files.map(async ({ path }) => {
            const info = await lstat(join(root, path)).catch(() => null)
            return [path, info?.mtimeMs, info?.ctimeMs, info?.size]
          }),
        ),
      ])
    const upstream = upstreamValue.trim() || null
    const counts = upstream
      ? (
          await runGit(root, [
            'rev-list',
            '--left-right',
            '--count',
            'HEAD...@{upstream}',
          ])
        )
          .trim()
          .split(/\s+/)
          .map(Number)
      : [0, 0]
    let additions = 0,
      deletions = 0
    for (const record of (numstat + stagedNumstat).split('\0')) {
      if (!record) continue
      const [added, deleted] = record.split('\t')
      if (/^\d+$/.test(added)) additions += Number(added)
      if (/^\d+$/.test(deleted)) deletions += Number(deleted)
    }
    const branches = refs
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const [ref, symbolic] = line.split('\t')
        return symbolic
          ? []
          : [
              {
                ref,
                name: ref.replace(/^refs\/(heads|remotes)\//, ''),
                local: ref.startsWith('refs/heads/'),
              },
            ]
      })
    const conflicted = files.some((file) => file.conflicted)
    const operationInProgress = operations.some(Boolean)
    const actions: WorkspaceGitDto['actions'] = [GIT_ACTION.VIEW_CHANGES]
    if (compareUrl) actions.push(GIT_ACTION.COMPARE_BRANCH)
    if (!operationInProgress && !conflicted) {
      if (
        !files.length &&
        branches.some((item) => item.local && item.name !== branch)
      )
        actions.push(GIT_ACTION.SWITCH_BRANCH)
      if (
        files.some((file) => file.worktreeStatus !== GIT_FILE_STATUS.UNMODIFIED)
      )
        actions.push(GIT_ACTION.STAGE)
      if (
        files.some(
          (file) =>
            file.indexStatus !== GIT_FILE_STATUS.UNMODIFIED &&
            file.indexStatus !== GIT_FILE_STATUS.UNTRACKED,
        )
      )
        actions.push(GIT_ACTION.UNSTAGE, GIT_ACTION.COMMIT)
      if (branch && upstream && counts[0] > 0 && counts[1] === 0)
        actions.push(GIT_ACTION.PUSH)
    }
    return {
      state: conflicted
        ? GIT_REPOSITORY_STATE.CONFLICTED
        : files.length
          ? GIT_REPOSITORY_STATE.DIRTY
          : GIT_REPOSITORY_STATE.CLEAN,
      revision: createHash('sha256')
        .update(
          JSON.stringify([
            head,
            branch,
            upstream,
            compareUrl,
            counts,
            rawStatus,
            indexEntries,
            fileVersions,
            operations,
          ]),
        )
        .digest('hex'),
      branch,
      head,
      upstream,
      compareUrl,
      ahead: counts[0],
      behind: counts[1],
      additions,
      deletions,
      operationInProgress,
      files,
      branches,
      actions,
    }
  }

  /** 差异仅接受当前状态里的文件或服务器枚举的分支，不接受任意 Git 参数。 */
  async diff(
    workspaceId: string,
    input: { path?: string; base?: string; staged?: boolean },
  ) {
    const root = await this.root(workspaceId)
    if (!root) fail('当前工作区不是 Git 仓库。')
    const snapshot = await this.readSnapshot(root!)
    const flags = [
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
    ]
    if (input.base) {
      const branch = snapshot.branches.find((item) => item.ref === input.base)
      if (!branch || !snapshot.head)
        fail('比较分支不存在。', GIT_ERROR_CODE.INVALID_REQUEST)
      const ref = branch!.ref
      return {
        content: await runGit(root!, ['diff', ...flags, `${ref}...HEAD`, '--']),
      }
    }
    const file = snapshot.files.find((item) => item.path === input.path)
    if (!file) fail('文件已不在变更列表，请刷新。', GIT_ERROR_CODE.STALE_STATE)
    if (file!.indexStatus === GIT_FILE_STATUS.UNTRACKED) {
      const info = await lstat(join(root!, file!.path))
      if (!info.isFile() || info.size > MAX_OUTPUT)
        return {
          content: '未跟踪的目录、符号链接或大文件，请使用本地工具查看。',
        }
      return {
        content: await runGit(
          root!,
          ['diff', ...flags, '--no-index', '--', '/dev/null', file!.path],
          [1],
        ),
      }
    }
    return {
      content: await runGit(root!, [
        'diff',
        ...flags,
        ...(input.staged ? ['--cached'] : []),
        '--',
        file!.path,
        ...(file!.originalPath ? [file!.originalPath] : []),
      ]),
    }
  }

  /** 写入前刷新快照并确认版本；不会自动暂存、强制切分支或隐式推送。 */
  async act(workspaceId: string, input: GitActionDto) {
    const root = await this.root(workspaceId)
    if (!root) fail('当前工作区不是 Git 仓库。')
    const previous = this.mutations.get(root!) ?? Promise.resolve()
    const result = previous
      .catch(() => undefined)
      .then(async () => {
        const snapshot = await this.readSnapshot(root!)
        if (snapshot.revision !== input.revision)
          fail('仓库已变化，请刷新后重新确认。', GIT_ERROR_CODE.STALE_STATE)
        if (!snapshot.actions.includes(input.action))
          fail('当前仓库状态不支持此操作。')
        switch (input.action) {
          case GIT_ACTION.STAGE:
          case GIT_ACTION.UNSTAGE: {
            const file = snapshot.files.find((item) => item.path === input.path)
            if (!file) fail('文件已不在变更列表。')
            const paths = [
              file!.path,
              ...(file!.originalPath ? [file!.originalPath] : []),
            ]
            if (
              paths.some(
                (path) =>
                  isAbsolute(path) ||
                  relative(root!, resolve(root!, path)).startsWith('..'),
              )
            )
              fail('文件路径超出工作区。')
            if (input.action === GIT_ACTION.STAGE) {
              await runGit(root!, ['add', '--', file!.path])
              break
            }
            if (snapshot.head)
              await runGit(root!, ['restore', '--staged', '--', ...paths])
            else await runGit(root!, ['rm', '--cached', '--', ...paths])
            break
          }
          case GIT_ACTION.SWITCH_BRANCH:
            if (
              !snapshot.branches.some(
                (item) => item.local && item.name === input.branch,
              ) ||
              input.branch === snapshot.branch
            )
              fail('请选择其他本地分支。')
            await runGit(root!, ['switch', '--no-guess', input.branch!])
            break
          case GIT_ACTION.COMMIT:
            if (
              !input.message?.trim() ||
              input.message.length > 10_000 ||
              input.message.includes('\0')
            )
              fail('请填写有效提交说明。', GIT_ERROR_CODE.INVALID_REQUEST)
            await runGit(root!, ['commit', '-m', input.message!])
            break
          case GIT_ACTION.PUSH: {
            const remote = (
              await runGit(root!, [
                'config',
                '--get',
                `branch.${snapshot.branch}.remote`,
              ])
            ).trim()
            const target = (
              await runGit(root!, [
                'config',
                '--get',
                `branch.${snapshot.branch}.merge`,
              ])
            ).trim()
            if (
              !remote ||
              remote === '.' ||
              remote.startsWith('-') ||
              !target.startsWith('refs/heads/')
            )
              fail('请先配置可推送的远端上游分支。')
            await runGit(root!, [
              'push',
              '--no-follow-tags',
              '--recurse-submodules=no',
              '--',
              remote,
              `HEAD:${target}`,
            ])
            break
          }
          default:
            fail('不支持此写操作。', GIT_ERROR_CODE.INVALID_REQUEST)
        }
        try {
          return await this.readSnapshot(root!)
        } catch {
          throw new WorkspaceError(
            GIT_ERROR_CODE.UNAVAILABLE,
            'Git 操作已执行，但状态刷新失败。请刷新后确认结果，勿重复操作。',
            409,
          )
        }
      })
    this.mutations.set(root!, result)
    try {
      return await result
    } finally {
      if (this.mutations.get(root!) === result) this.mutations.delete(root!)
    }
  }
}
