import type {
  AssistantSkill,
  CapabilityCommand,
  PluginSettingsTab,
} from '../../../settings/index.ts'

export type ComposerMenuMode = 'mention' | 'plus' | 'slash'
export type ComposerContextKind = 'command' | 'mcp' | 'plugin' | 'skill'

export interface ComposerContextItem {
  description: string
  id: string
  kind: ComposerContextKind
  label: string
  reference: string
  sourceId?: string
}

/** 命令会影响本轮 Agent 的交互方式，并在发送成功后清除。 */
export const isComposerModeContext = (item: ComposerContextItem) =>
  item.kind === 'command'

export interface ComposerTrigger {
  end: number
  mode: Exclude<ComposerMenuMode, 'plus'>
  query: string
  start: number
}

export type ComposerCapability = {
  contextReference?: string
  description: string
  id: string
  kind: 'attachment' | 'command' | 'mcp' | 'plugin' | 'skill'
  label: string
  settingsTab?: PluginSettingsTab
  sourceId?: string
}

export interface ComposerCapabilityGroup {
  id: string
  items: ComposerCapability[]
  label: string
}

const ADD_ITEMS: readonly ComposerCapability[] = [
  {
    description: '从设备中选择一个或多个文件。',
    id: 'attachment-files',
    kind: 'attachment',
    label: '文件',
  },
]

const matchesQuery = (item: ComposerCapability, query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true

  return `${item.label} ${item.description} ${item.contextReference ?? ''}`
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}

const filterGroups = (groups: ComposerCapabilityGroup[], query: string) =>
  groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesQuery(item, query)),
    }))
    .filter((group) => group.items.length > 0)

/** 解析光标前有效的 @ 或 / 唤醒词。 */
export function findComposerTrigger(
  value: string,
  caret: number,
): ComposerTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const match = value.slice(0, safeCaret).match(/(?:^|\s)([@/])([^\s@/]*)$/u)

  if (!match) return null

  const symbol = match[1]
  const query = match[2]
  if (!symbol || query == null) return null

  return {
    end: safeCaret,
    mode: symbol === '@' ? 'mention' : 'slash',
    query,
    start: safeCaret - query.length - 1,
  }
}

/** 将设置状态映射成 +、@、/ 共用的能力菜单。 */
export function getComposerCapabilityGroups(
  mode: ComposerMenuMode,
  skills: readonly AssistantSkill[],
  commands: readonly CapabilityCommand[],
  query = '',
  plugins: readonly {
    id: string
    name: string
    description: string
    enabled: boolean
  }[] = [],
): ComposerCapabilityGroup[] {
  const commandItems: ComposerCapability[] = commands.map((command) => ({
    description: command.description,
    id: command.id,
    contextReference: `/${command.name}`,
    kind: 'command',
    label: command.name,
    sourceId: command.id,
  }))
  if (mode !== 'slash') {
    return filterGroups(
      [
        {
          id: 'plugins',
          label: '插件',
          items: plugins
            .filter((plugin) => plugin.enabled)
            .map((plugin) => ({
              id: `plugin-${plugin.id}`,
              sourceId: plugin.id,
              label: plugin.name,
              description: plugin.description,
              kind: 'plugin',
              contextReference: `@${plugin.name}`,
            })),
        },
        { id: 'commands', items: commandItems, label: '命令' },
        { id: 'add', items: [...ADD_ITEMS], label: '添加' },
      ],
      query,
    )
  }

  const skillItems: ComposerCapability[] = skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      description: skill.description,
      id: `skill-${skill.id}`,
      contextReference: `/${skill.name}`,
      kind: 'skill',
      label: skill.name,
      sourceId: skill.id,
    }))
  return filterGroups(
    [
      { id: 'commands', items: commandItems, label: '命令' },
      { id: 'skills', items: skillItems, label: 'Skills' },
    ],
    query,
  )
}

/** 从正文中移除已解析的唤醒词，并返回新的光标位置。 */
export function removeComposerRange(value: string, start: number, end: number) {
  return {
    caret: start,
    value: `${value.slice(0, start)}${value.slice(end)}`,
  }
}

/** 将菜单能力转换为可渲染、可提交的结构化上下文。 */
export function createComposerContextItem(
  capability: ComposerCapability,
): ComposerContextItem | null {
  if (
    capability.kind === 'attachment' ||
    capability.settingsTab ||
    !capability.contextReference
  ) {
    return null
  }

  return {
    description: capability.description,
    id: capability.id,
    kind: capability.kind,
    label: capability.label,
    reference: capability.contextReference,
    sourceId: capability.sourceId,
  }
}

/** 按“命令单选、其他类型多选去重”规则合并上下文。 */
export function addComposerContextItem(
  currentItems: readonly ComposerContextItem[],
  nextItem: ComposerContextItem,
): ComposerContextItem[] {
  if (nextItem.kind === 'command') {
    return [nextItem, ...currentItems.filter((item) => item.kind !== 'command')]
  }

  return currentItems.some((item) => item.id === nextItem.id)
    ? [...currentItems]
    : [...currentItems, nextItem]
}

/** 返回设置变化后上下文不可用的原因，可用时返回 null。 */
export function getComposerContextUnavailableReason(
  item: ComposerContextItem,
  skills: readonly AssistantSkill[],
  commands: readonly CapabilityCommand[],
  plugins: readonly { id: string; enabled: boolean }[] = [],
) {
  if (
    item.kind === 'plugin' &&
    !plugins.some((plugin) => plugin.id === item.sourceId && plugin.enabled)
  )
    return '插件已禁用或卸载'
  if (item.kind === 'skill') {
    const skill = skills.find((candidate) => candidate.id === item.sourceId)
    if (!skill) return '技能已移除'
    if (!skill.enabled) return '技能已禁用'
  }

  if (
    item.kind === 'command' &&
    !commands.some((command) => command.id === item.sourceId)
  ) {
    return '命令已移除'
  }

  return null
}
