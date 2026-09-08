import {
  SKILL_IMPORT_STATUS,
  SKILL_IMPORT_CANDIDATE_STATUS,
  SKILL_INSTALL_STATUS,
  type SkillImportStatus,
  type SkillImportCandidateStatus,
} from '@oh-my-harness/shared'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  lstat,
  realpath,
} from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { loadSkills } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import {
  exists,
  extractZip,
  fetchGit,
  inspectTree,
  normalizeGitSource,
  PluginError,
  resolveContentPath,
} from '@oh-my-harness/agent-plugins'
import { validSkill } from './capability-service.ts'

export type SkillImportCandidate = {
  key: string
  path: string
  name: string
  description: string
  status: SkillImportCandidateStatus
  message?: string
}
export type SkillImport = {
  id: string
  status: SkillImportStatus
  candidates: SkillImportCandidate[]
  error?: string
}
type Job = {
  value: SkillImport
  directory: string
  controller: AbortController
  work: Promise<void>
  timer: ReturnType<typeof setTimeout>
}

/** 管理独立技能的有限暂存任务；文件目录是唯一安装事实，不创建插件记录。 */
export class SkillImportService {
  private readonly jobs = new Map<string, Job>()
  private readonly staging: string
  private readonly skills: string
  private readonly ready: Promise<void>
  private closed = false
  private readonly allowedGitHosts?: string[]
  // ponytail: 用户级低频导入串行提交；多进程部署时再增加跨进程锁。
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(dataDirectory: string, allowedGitHosts?: string[]) {
    this.allowedGitHosts = allowedGitHosts
    this.staging = join(dataDirectory, 'skill-imports')
    this.skills = join(dataDirectory, 'skills')
    this.ready = this.initialize()
  }

  private async initialize() {
    await mkdir(this.skills, { recursive: true, mode: 0o700 })
    if ((await lstat(this.skills)).isSymbolicLink())
      throw new PluginError('SKILL_DIRECTORY_INVALID', '技能目录不能是链接')
    await chmod(this.skills, 0o700)
    await mkdir(this.staging, { recursive: true, mode: 0o700 })
    if ((await lstat(this.staging)).isSymbolicLink())
      throw new PluginError('SKILL_DIRECTORY_INVALID', '暂存目录不能是链接')
    await chmod(this.staging, 0o700)
    // 仅回收本服务格式且已过期的暂存，不触及已安装技能或其他目录。
    for (const entry of await readdir(this.staging, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
      const path = join(this.staging, entry.name)
      if ((await lstat(path)).mtimeMs < Date.now() - 30 * 60_000)
        await rm(path, { recursive: true, force: true })
    }
  }

  /** 获取来源仅写入独立暂存目录，响应不包含宿主绝对路径。 */
  async create(input: { url: string } | { zip: Buffer; name: string }) {
    await this.ready
    if (this.closed)
      throw new PluginError('SKILL_IMPORT_CLOSED', '技能导入已关闭', 503)
    if (this.jobs.size >= 20)
      throw new PluginError(
        'SKILL_IMPORT_LIMIT',
        '待处理导入过多，请先取消现有导入',
        429,
      )
    const source =
      'url' in input
        ? normalizeGitSource(input.url, this.allowedGitHosts)
        : undefined
    const id = randomUUID()
    const job: Job = {
      value: { id, status: SKILL_IMPORT_STATUS.FETCHING, candidates: [] },
      directory: join(this.staging, id),
      controller: new AbortController(),
      work: Promise.resolve(),
      timer: setTimeout(() => {
        void this.cancel(id).catch(() => undefined)
      }, 30 * 60_000),
    }
    job.timer.unref()
    this.jobs.set(id, job)
    job.work = (async () => {
      try {
        await mkdir(job.directory, { mode: 0o700 })
        const content = join(job.directory, 'content')
        if ('zip' in input) {
          await mkdir(content, { mode: 0o700 })
          await extractZip(input.zip, content, job.controller.signal)
        } else {
          await fetchGit(
            source!,
            content,
            job.controller.signal,
            this.allowedGitHosts,
          )
        }
        await inspectTree(content)
        const canonicalContent = await realpath(content)
        const root = source?.path
          ? await resolveContentPath(canonicalContent, source.path)
          : canonicalContent
        await this.discover(job, root, canonicalContent)
        job.controller.signal.throwIfAborted()
        if (!job.value.candidates.length)
          throw new PluginError(
            'SKILL_NOT_FOUND',
            '未找到 SKILL.md，请选择包含技能目录的仓库或 ZIP',
          )
        job.value.status = SKILL_IMPORT_STATUS.READY
      } catch (error) {
        job.value.status = job.controller.signal.aborted
          ? SKILL_IMPORT_STATUS.CANCELLED
          : SKILL_IMPORT_STATUS.FAILED
        job.value.error =
          error instanceof PluginError
            ? error.message
            : '技能读取失败，请检查文件格式、大小或网络'
        await rm(job.directory, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }
    })()
    return structuredClone(job.value)
  }

  /** 遇到 SKILL.md 即以该目录为独立资源边界，避免嵌套技能被重复导入。 */
  private async discover(
    job: Job,
    directory: string,
    content: string,
  ): Promise<void> {
    job.controller.signal.throwIfAborted()
    if (job.value.candidates.length >= 200)
      throw new PluginError(
        'SKILL_CANDIDATE_LIMIT',
        '技能入口超过 200 个，请指定更小的仓库子目录或 ZIP',
      )
    if (await exists(join(directory, 'SKILL.md'))) {
      const candidate: SkillImportCandidate = {
        key: randomUUID(),
        path: relative(content, directory) || '.',
        name: basename(directory),
        description: '',
        status: SKILL_IMPORT_CANDIDATE_STATUS.INVALID,
        message: 'SKILL.md 无效，请检查 name、description 与内容长度',
      }
      const env = new NodeExecutionEnv({ cwd: directory })
      try {
        const loaded = await loadSkills(env, directory)
        const skill = loaded.skills.find(
          (item) => item.filePath === join(directory, 'SKILL.md'),
        )
        if (skill && validSkill(skill)) {
          candidate.name = skill.name
          candidate.description = skill.description
          candidate.status = await this.installedStatus(skill.name, directory)
          candidate.message =
            candidate.status === SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT
              ? '已存在同名技能且内容不同，不会覆盖'
              : undefined
        }
      } catch {
        candidate.status = SKILL_IMPORT_CANDIDATE_STATUS.INVALID
        candidate.message = '技能文件或已有目录无法安全读取，请检查内容后重试'
      } finally {
        await env.cleanup()
      }
      job.value.candidates.push(candidate)
      return
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        entry.name !== '.git' &&
        entry.name !== 'node_modules'
      )
        await this.discover(job, join(directory, entry.name), content)
    }
  }

  private async installedStatus(name: string, source: string) {
    const env = new NodeExecutionEnv({ cwd: this.skills })
    try {
      const loaded = await loadSkills(env, this.skills)
      const matches = loaded.skills.filter((skill) => skill.name === name)
      if (matches.length) {
        if (
          matches.length !== 1 ||
          basename(matches[0].filePath) !== 'SKILL.md'
        )
          return SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT
        const root = await resolveContentPath(
          this.skills,
          relative(this.skills, dirname(matches[0].filePath)),
        )
        return (await inspectTree(root)) === (await inspectTree(source))
          ? SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED
          : SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT
      }
      return (await exists(join(this.skills, name)))
        ? SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT
        : SKILL_IMPORT_CANDIDATE_STATUS.AVAILABLE
    } finally {
      await env.cleanup()
    }
  }

  private job(id: string) {
    const job = this.jobs.get(id)
    if (!job)
      throw new PluginError(
        'SKILL_IMPORT_NOT_FOUND',
        '导入已过期或被取消，请重新导入',
        404,
      )
    return job
  }

  /** 只读任务状态；已完成的解析结果保持到取消或超时。 */
  get(id: string) {
    return structuredClone(this.job(id).value)
  }

  /** 在提交点重新判重，完整复制后一次发布；失败绝不覆盖已有技能。 */
  install(id: string, key: string) {
    const operation = this.mutations.then(async () => {
      const job = this.job(id)
      const candidate = job.value.candidates.find((item) => item.key === key)
      if (
        job.value.status !== SKILL_IMPORT_STATUS.READY ||
        !candidate ||
        candidate.status === SKILL_IMPORT_CANDIDATE_STATUS.INVALID
      )
        throw new PluginError('SKILL_IMPORT_INVALID', '请选择有效的技能入口')
      job.controller.signal.throwIfAborted()
      const source = await resolveContentPath(
        join(job.directory, 'content'),
        candidate.path,
      )
      const status = await this.installedStatus(candidate.name, source)
      if (status === SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT)
        throw new PluginError(
          'SKILL_NAME_CONFLICT',
          '已存在同名技能且内容不同，不会覆盖',
          409,
        )
      if (status === SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED)
        return {
          skillId: `skill:${candidate.name}`,
          name: candidate.name,
          status: SKILL_INSTALL_STATUS.ALREADY_INSTALLED,
        }
      const pending = join(job.directory, 'publish')
      const destination = join(this.skills, candidate.name)
      let published = false
      try {
        await cp(source, pending, {
          recursive: true,
          errorOnExist: true,
          force: false,
          filter: (path) => basename(path) !== '.git',
        })
        await this.secureTree(pending)
        if ((await inspectTree(pending)) !== (await inspectTree(source)))
          throw new PluginError(
            'SKILL_CONTENT_CHANGED',
            '技能内容发生变化，请重新导入',
          )
        job.controller.signal.throwIfAborted()
        await rename(pending, destination)
        published = true
        const env = new NodeExecutionEnv({ cwd: this.skills })
        try {
          const loaded = await loadSkills(env, this.skills)
          if (
            !loaded.skills.some(
              (skill) =>
                skill.filePath === join(destination, 'SKILL.md') &&
                skill.name === candidate.name &&
                validSkill(skill),
            )
          )
            throw new PluginError(
              'SKILL_NOT_DISCOVERABLE',
              '技能被用户目录的 SKILL.md 或忽略规则遮蔽，导入未生效',
            )
        } finally {
          await env.cleanup()
        }
        candidate.status = SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED
        return {
          skillId: `skill:${candidate.name}`,
          name: candidate.name,
          status: SKILL_INSTALL_STATUS.INSTALLED,
        }
      } catch (error) {
        if (published) await rm(destination, { recursive: true, force: true })
        throw error
      } finally {
        await rm(pending, { recursive: true, force: true })
      }
    })
    this.mutations = operation.catch(() => undefined)
    return operation
  }

  private async secureTree(directory: string) {
    await chmod(directory, 0o700)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await this.secureTree(path)
      else await chmod(path, 0o600)
    }
  }

  /** 取消先中断获取，并等待提交边界结束后释放任务自己的临时目录。 */
  async cancel(id: string) {
    const job = this.jobs.get(id)
    if (!job) return
    clearTimeout(job.timer)
    job.controller.abort()
    await job.work
    await this.mutations
    await rm(job.directory, { recursive: true, force: true })
    this.jobs.delete(id)
  }

  /** 关闭服务时释放所有未持久化的导入任务。 */
  async close() {
    this.closed = true
    await this.ready
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)))
  }
}
