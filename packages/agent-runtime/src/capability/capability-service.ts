import { dirname, join } from 'node:path'

import {
  formatPromptTemplateInvocation,
  loadSourcedPromptTemplates,
  loadSourcedSkills,
  parseCommandArgs,
  type PromptTemplate,
  type Skill,
} from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type {
  PluginService,
  PluginSnapshot,
} from '@oh-my-harness/agent-plugins'

import { AgentRuntimeError } from '../error/agent-runtime-error.ts'

export type AgentSkillSource = 'user' | 'plugin'
export type AgentCommandSource = 'builtin' | 'project' | 'user' | 'plugin'
export type AgentCapabilitySource = AgentCommandSource | AgentSkillSource

export interface AgentCapabilityDiagnostic {
  code: string
  message: string
  source: AgentCapabilitySource
}

export interface AgentCapabilitySkill {
  pluginId?: string
  description: string
  enabled: boolean
  id: string
  name: string
  source: AgentSkillSource
}

export interface AgentCapabilityCommand {
  pluginId?: string
  description: string
  id: string
  name: string
  source: AgentCommandSource
}

export interface AgentCapabilityCatalog {
  plugins: { id: string; name: string; description: string; enabled: boolean }[]
  commands: AgentCapabilityCommand[]
  diagnostics: AgentCapabilityDiagnostic[]
  skills: AgentCapabilitySkill[]
}

export interface ResolvedSkill extends AgentCapabilitySkill {
  resourceRootDirectory?: string
  content: string
  rootDirectory: string
}

export interface LoadedCommand extends AgentCapabilityCommand {
  template: PromptTemplate
}

export interface LoadedSkill extends ResolvedSkill {
  disableModelInvocation: boolean
}

export interface LoadedCatalog {
  commands: LoadedCommand[]
  diagnostics: AgentCapabilityDiagnostic[]
  skills: LoadedSkill[]
}

const MAX_CAPABILITY_CONTENT = 200_000
const CATALOG_CACHE_MS = 5_000
const capabilityNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u

const BUILTIN_COMMANDS: readonly PromptTemplate[] = [
  {
    content:
      '先为下面的请求制定一份简洁、可执行的计划；除非用户明确要求，否则本轮只输出计划，不开始实施。\n\n$ARGUMENTS',
    description: '先整理任务步骤，本轮只输出计划。',
    name: 'plan',
  },
  {
    content:
      '审查下面的请求或当前工作区改动，优先指出正确性、安全性和回归风险，并给出可验证的结论。\n\n$ARGUMENTS',
    description: '检查当前工作区改动与潜在风险。',
    name: 'review',
  },
]

const skillId = (name: string) => `skill:${name}`
const commandId = (name: string) => `command:${name}`

const safeDiagnostic = (
  code: string,
  source: AgentCapabilitySource,
): AgentCapabilityDiagnostic => ({
  code,
  message: '能力文件无效，请检查对应目录。',
  source,
})

const deduplicate = <T extends { name: string; source: string }>(
  values: T[],
  diagnostics: AgentCapabilityDiagnostic[],
) => {
  const duplicateKeys = new Set<string>()
  const seenKeys = new Set<string>()
  for (const value of values) {
    const key = `${value.source}:${value.name}`
    if (seenKeys.has(key)) duplicateKeys.add(key)
    seenKeys.add(key)
  }
  for (const key of duplicateKeys) {
    diagnostics.push(
      safeDiagnostic(
        'duplicate_name',
        key.split(':', 1)[0] as AgentCapabilitySource,
      ),
    )
  }
  return values.filter(
    (value) => !duplicateKeys.has(`${value.source}:${value.name}`),
  )
}

const preferHigherPriority = <
  T extends { name: string; source: AgentCapabilitySource },
>(
  values: T[],
) => {
  const byName = new Map<string, T>()
  const sourcePriority: Record<AgentCapabilitySource, number> = {
    plugin: 1,
    builtin: 0,
    user: 3,
    project: 4,
  }
  for (const value of values) {
    const current = byName.get(value.name)
    if (
      !current ||
      sourcePriority[value.source] > sourcePriority[current.source]
    ) {
      byName.set(value.name, value)
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

/** 从 oh-my-harness 用户目录加载 Skills，并从用户及项目目录加载命令。 */
export class AgentCapabilityService {
  // ponytail: 5s TTL keeps discovery cheap; replace with file watching only if live edits require it.
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<LoadedCatalog> }
  >()
  private readonly dataDirectory: string
  private readonly plugins?: PluginService
  private readonly pluginCache = new Map<string, Promise<LoadedCatalog>>()

  constructor(dataDirectory: string, plugins?: PluginService) {
    this.dataDirectory = dataDirectory
    this.plugins = plugins
  }

  async list(cwd: string): Promise<AgentCapabilityCatalog> {
    const registry = await this.plugins?.list()
    const lease = await this.plugins?.snapshot(
      registry?.installations
        .filter((item) => item.enabled)
        .map((item) => item.id) ?? [],
    )
    let catalog: LoadedCatalog
    try {
      catalog = await this.withPlugins(cwd, lease?.installations ?? [])
    } finally {
      await lease?.release()
    }
    return {
      plugins:
        registry?.installations.map((item) => ({
          id: item.id,
          name: item.activeRevision.descriptor.name,
          description: item.activeRevision.descriptor.description,
          enabled: item.enabled,
        })) ?? [],
      commands: catalog.commands.map(
        ({ template: _template, ...command }) => command,
      ),
      diagnostics: catalog.diagnostics,
      skills: catalog.skills.map(
        ({
          content: _content,
          disableModelInvocation: _disabled,
          rootDirectory: _root,
          resourceRootDirectory: _resourceRoot,
          ...skill
        }) => skill,
      ),
    }
  }

  async resolve(
    cwd: string,
    input: {
      commandId?: string
      content: string
      skillIds?: readonly string[]
      pluginIds?: readonly string[]
    },
  ) {
    const owners = [
      ...(input.skillIds ?? []),
      ...(input.commandId ? [input.commandId] : []),
    ].flatMap((id) => (id.split(':').length === 3 ? [id.split(':')[1]] : []))
    const lease = await this.plugins?.snapshot([
      ...new Set([...(input.pluginIds ?? []), ...owners]),
    ])
    try {
      const catalog = await this.withPlugins(cwd, lease?.installations ?? [])
      const defaultSkills = (lease?.installations ?? []).flatMap((plugin) => {
        const available = catalog.skills.filter(
          (skill) =>
            skill.pluginId === plugin.id && !skill.disableModelInvocation,
        )
        const primary =
          available.find(
            (skill) =>
              skill.name ===
              `${plugin.activeRevision.descriptor.name}:${plugin.activeRevision.descriptor.name}`,
          ) ?? (available.length === 1 ? available[0] : undefined)
        return primary ? [primary.id] : []
      })
      const skills = [
        ...new Set([...(input.skillIds ?? []), ...defaultSkills]),
      ].map((id) => {
        const skill = catalog.skills.find((candidate) => candidate.id === id)
        if (!skill) {
          throw new AgentRuntimeError(
            'AGENT_SKILL_NOT_FOUND',
            '所选 Skill 不存在或不可用。',
            400,
          )
        }
        return skill
      })
      const command = input.commandId
        ? catalog.commands.find((candidate) => candidate.id === input.commandId)
        : undefined
      if (input.commandId && !command) {
        throw new AgentRuntimeError(
          'AGENT_COMMAND_NOT_FOUND',
          '所选命令不存在或不可用。',
          400,
        )
      }
      return {
        plugins: lease?.installations ?? [],
        release: () => lease?.release() ?? Promise.resolve(),
        catalog,
        command,
        commandContent: command
          ? formatPromptTemplateInvocation(
              command.template,
              parseCommandArgs(input.content),
            )
          : undefined,
        skills,
      }
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  private async withPlugins(
    cwd: string,
    plugins: readonly PluginSnapshot[],
  ): Promise<LoadedCatalog> {
    const base = await this.load(cwd)
    const additions = await Promise.all(
      plugins.map((plugin) => {
        const key = plugin.rootDirectory
        let value = this.pluginCache.get(key)
        if (!value) {
          value = this.loadPlugin(plugin)
          this.pluginCache.set(key, value)
          if (this.pluginCache.size > 200)
            this.pluginCache.delete(this.pluginCache.keys().next().value!)
          void value.catch(() => this.pluginCache.delete(key))
        }
        return value
      }),
    )
    return {
      commands: [
        ...base.commands,
        ...additions.flatMap((item) => item.commands),
      ],
      skills: [...base.skills, ...additions.flatMap((item) => item.skills)],
      diagnostics: [
        ...base.diagnostics,
        ...additions.flatMap((item) => item.diagnostics),
      ],
    }
  }

  private async loadPlugin(plugin: PluginSnapshot): Promise<LoadedCatalog> {
    const descriptor = plugin.activeRevision.descriptor
    const env = new NodeExecutionEnv({ cwd: plugin.rootDirectory })
    try {
      const [skills, commands] = await Promise.all([
        loadSourcedSkills(
          env,
          descriptor.skills.map((path) => ({
            path: join(plugin.rootDirectory, path),
            source: 'plugin' as const,
          })),
        ),
        loadSourcedPromptTemplates(
          env,
          descriptor.commands.map((path) => ({
            path: join(plugin.rootDirectory, path),
            source: 'plugin' as const,
          })),
        ),
      ])
      const diagnostics = [...skills.diagnostics, ...commands.diagnostics].map(
        (item) => safeDiagnostic(item.code, 'plugin'),
      )
      return {
        skills: deduplicate(
          skills.skills.flatMap(({ skill }) =>
            this.validSkill(skill)
              ? [
                  {
                    id: `skill:${plugin.id}:${skill.name}`,
                    pluginId: plugin.id,
                    name: `${descriptor.name}:${skill.name}`,
                    source: 'plugin' as const,
                    enabled: true,
                    description: skill.description,
                    content: skill.content,
                    disableModelInvocation:
                      skill.disableModelInvocation === true,
                    rootDirectory: dirname(skill.filePath),
                    resourceRootDirectory: plugin.rootDirectory,
                  },
                ]
              : (diagnostics.push(safeDiagnostic('invalid_skill', 'plugin')),
                []),
          ),
          diagnostics,
        ),
        commands: deduplicate(
          commands.promptTemplates.flatMap(({ promptTemplate: template }) =>
            this.validCommand(template) && !/!\s*`/.test(template.content)
              ? [
                  {
                    id: `command:${plugin.id}:${template.name}`,
                    pluginId: plugin.id,
                    name: `${descriptor.name}:${template.name}`,
                    source: 'plugin' as const,
                    description: template.description ?? template.name,
                    template,
                  },
                ]
              : (diagnostics.push(
                  safeDiagnostic('unsupported_dynamic_command', 'plugin'),
                ),
                []),
          ),
          diagnostics,
        ),
        diagnostics,
      }
    } finally {
      await env.cleanup()
    }
  }

  private async load(cwd: string): Promise<LoadedCatalog> {
    const cached = this.cache.get(cwd)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const value = this.loadUncached(cwd)
    this.cache.set(cwd, { expiresAt: Date.now() + CATALOG_CACHE_MS, value })
    return value.catch((error: unknown) => {
      if (this.cache.get(cwd)?.value === value) this.cache.delete(cwd)
      throw error
    })
  }

  private async loadUncached(cwd: string): Promise<LoadedCatalog> {
    const env = new NodeExecutionEnv({ cwd })
    try {
      const [loadedSkills, loadedCommands] = await Promise.all([
        loadSourcedSkills(env, [
          { path: join(this.dataDirectory, 'skills'), source: 'user' as const },
        ]),
        loadSourcedPromptTemplates(env, [
          {
            path: join(this.dataDirectory, 'commands'),
            source: 'user' as const,
          },
          {
            path: join(cwd, '.agents', 'commands'),
            source: 'project' as const,
          },
        ]),
      ])
      const diagnostics: AgentCapabilityDiagnostic[] = [
        ...loadedSkills.diagnostics.map((item) =>
          safeDiagnostic(item.code, item.source),
        ),
        ...loadedCommands.diagnostics.map((item) =>
          safeDiagnostic(item.code, item.source),
        ),
      ]
      const skills = deduplicate(
        loadedSkills.skills.flatMap(({ skill, source }) =>
          this.validSkill(skill)
            ? [
                {
                  content: skill.content,
                  description: skill.description,
                  disableModelInvocation: skill.disableModelInvocation === true,
                  enabled: true,
                  id: skillId(skill.name),
                  name: skill.name,
                  rootDirectory: dirname(skill.filePath),
                  source,
                },
              ]
            : (diagnostics.push(safeDiagnostic('invalid_skill', source)), []),
        ),
        diagnostics,
      )
      const commands = deduplicate(
        loadedCommands.promptTemplates.flatMap(({ promptTemplate, source }) =>
          this.validCommand(promptTemplate)
            ? [
                {
                  description:
                    promptTemplate.description || promptTemplate.name,
                  id: commandId(promptTemplate.name),
                  name: promptTemplate.name,
                  source,
                  template: promptTemplate,
                },
              ]
            : (diagnostics.push(safeDiagnostic('invalid_command', source)), []),
        ),
        diagnostics,
      )
      return {
        commands: preferHigherPriority([
          ...BUILTIN_COMMANDS.map((template) => ({
            description: template.description || template.name,
            id: commandId(template.name),
            name: template.name,
            source: 'builtin' as const,
            template,
          })),
          ...commands,
        ]),
        diagnostics,
        skills: preferHigherPriority(skills),
      }
    } finally {
      await env.cleanup()
    }
  }

  private validSkill(skill: Skill) {
    return (
      capabilityNamePattern.test(skill.name) &&
      skill.description.length <= 1_024 &&
      skill.content.length <= MAX_CAPABILITY_CONTENT
    )
  }

  private validCommand(command: PromptTemplate) {
    return (
      capabilityNamePattern.test(command.name) &&
      (command.description?.length ?? 0) <= 1_024 &&
      command.content.length <= MAX_CAPABILITY_CONTENT
    )
  }
}
