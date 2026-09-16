import type {
  AssistantSkill,
  CapabilityCommand,
} from '../../../settings/index.ts'
import {
  MCP_CONNECTION_STATUS,
  COMPOSER_CAPABILITY_KIND,
  COMPOSER_MENU_MODE,
  type CapabilityKind,
  type ComposerCapabilityKind,
  type ComposerMenuMode,
} from '@oh-my-harness/shared'
import type { McpServerVo } from '../../../settings/mcp/types/mcp-vo.ts'
import type { PluginInstallationVo } from '../../../settings/plugins/types/plugin-vo.ts'

export type { ComposerMenuMode }
export type ComposerContextKind = CapabilityKind

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
  item.kind === COMPOSER_CAPABILITY_KIND.COMMAND

export interface ComposerTrigger {
  end: number
  mode: Exclude<ComposerMenuMode, typeof COMPOSER_MENU_MODE.PLUS>
  query: string
  start: number
}

export type ComposerCapability = {
  unavailableReason?: string | null
  contextReference?: string
  description: string
  id: string
  kind: ComposerCapabilityKind
  label: string
  sourceId?: string
}

export interface ComposerCapabilityGroup {
  id: string
  items: ComposerCapability[]
  label: string
  message?: string
}

const ADD_ITEMS: readonly ComposerCapability[] = [
  {
    description: '从设备中选择一个或多个文件。',
    id: 'attachment-files',
    kind: COMPOSER_CAPABILITY_KIND.ATTACHMENT,
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
    .filter((group) => group.items.length > 0 || group.message)

/** 选择只引用已启用且可调用的服务；状态变化后同样阻止发送过期引用。 */
export const getMcpUnavailableReason = (server?: McpServerVo) => {
  if (!server) return 'MCP 服务已移除'
  if (!server.enabled) return 'MCP 服务已停用'
  if (server.status !== MCP_CONNECTION_STATUS.CONNECTED)
    return 'MCP 服务尚未连接'
  if (!server.toolCount) return 'MCP 服务没有可用工具'
  return null
}

export const getPluginUnavailableReason = (plugin?: PluginInstallationVo) => {
  if (!plugin) return '插件已移除'
  if (plugin.error) return plugin.error
  if (!plugin.enabled) return '插件已停用'
  if (
    !plugin.skills.length &&
    !plugin.servers.some(
      (server) =>
        server.status === MCP_CONNECTION_STATUS.CONNECTED && server.toolCount,
    )
  )
    return '插件没有可用的 Skill 或已连接的 MCP 工具'
  return null
}

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
    mode:
      symbol === '@' ? COMPOSER_MENU_MODE.MENTION : COMPOSER_MENU_MODE.SLASH,
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
  mcpServers?: readonly McpServerVo[],
  mcpMessage?: string,
  plugins?: readonly PluginInstallationVo[],
  pluginMessage?: string,
): ComposerCapabilityGroup[] {
  const pluginGroups: ComposerCapabilityGroup[] = plugins
    ? [
        {
          id: 'plugins',
          label: '插件',
          message:
            pluginMessage ||
            (!plugins.length ? '尚未安装插件，请在插件市场安装。' : undefined),
          items: plugins.map((plugin) => ({
            id: `plugin-${plugin.id}`,
            kind: COMPOSER_CAPABILITY_KIND.PLUGIN,
            label: plugin.manifest.displayName,
            description:
              pluginMessage ||
              getPluginUnavailableReason(plugin) ||
              plugin.manifest.description,
            unavailableReason:
              pluginMessage || getPluginUnavailableReason(plugin),
            contextReference: `@${plugin.manifest.displayName}`,
            sourceId: plugin.id,
          })),
        },
      ]
    : []
  const mcpGroups: ComposerCapabilityGroup[] = mcpServers
    ? [
        {
          id: 'mcp',
          label: 'MCP',
          message:
            mcpMessage ||
            (!mcpServers.length
              ? '尚未配置 MCP 服务，请在设置中添加。'
              : undefined),
          items: mcpServers.map((server) => ({
            id: `mcp-${server.id}`,
            kind: COMPOSER_CAPABILITY_KIND.MCP,
            label: server.name,
            description:
              mcpMessage ||
              getMcpUnavailableReason(server) ||
              `${server.toolCount} 个工具 · 本轮优先使用`,
            unavailableReason: mcpMessage || getMcpUnavailableReason(server),
            contextReference: `/mcp:${server.name}`,
            sourceId: server.id,
          })),
        },
      ]
    : []
  const commandItems: ComposerCapability[] = commands.map((command) => ({
    description: command.description,
    id: command.id,
    contextReference: `/${command.name}`,
    kind: COMPOSER_CAPABILITY_KIND.COMMAND,
    label: command.name,
    sourceId: command.id,
  }))
  if (mode !== COMPOSER_MENU_MODE.SLASH) {
    return filterGroups(
      [
        ...(mode === COMPOSER_MENU_MODE.MENTION ? pluginGroups : []),
        { id: 'commands', items: commandItems, label: '命令' },
        { id: 'add', items: [...ADD_ITEMS], label: '添加' },
        ...mcpGroups,
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
      kind: COMPOSER_CAPABILITY_KIND.SKILL,
      label: skill.pluginName
        ? `${skill.pluginName} · ${skill.name}`
        : skill.name,
      sourceId: skill.id,
    }))
  return filterGroups(
    [
      { id: 'commands', items: commandItems, label: '命令' },
      { id: 'skills', items: skillItems, label: 'Skills' },
      ...mcpGroups,
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
    capability.kind === COMPOSER_CAPABILITY_KIND.ATTACHMENT ||
    capability.unavailableReason ||
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
  if (nextItem.kind === COMPOSER_CAPABILITY_KIND.COMMAND) {
    return [
      nextItem,
      ...currentItems.filter(
        (item) => item.kind !== COMPOSER_CAPABILITY_KIND.COMMAND,
      ),
    ]
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
  mcpServers: readonly McpServerVo[] = [],
  mcpMessage?: string,
  plugins: readonly PluginInstallationVo[] = [],
  pluginMessage?: string,
) {
  if (item.kind === COMPOSER_CAPABILITY_KIND.PLUGIN)
    return (
      pluginMessage ||
      getPluginUnavailableReason(
        plugins.find((plugin) => plugin.id === item.sourceId),
      )
    )
  if (item.kind === COMPOSER_CAPABILITY_KIND.MCP) {
    return (
      mcpMessage ||
      getMcpUnavailableReason(
        mcpServers.find((server) => server.id === item.sourceId),
      )
    )
  }
  if (item.kind === COMPOSER_CAPABILITY_KIND.SKILL) {
    const skill = skills.find((candidate) => candidate.id === item.sourceId)
    if (!skill) return '技能已移除'
    if (!skill.enabled) return '技能已禁用'
  }

  if (
    item.kind === COMPOSER_CAPABILITY_KIND.COMMAND &&
    !commands.some((command) => command.id === item.sourceId)
  ) {
    return '命令已移除'
  }

  return null
}
