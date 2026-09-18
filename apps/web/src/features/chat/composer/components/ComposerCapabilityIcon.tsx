import { BookOpen, FilePlus, Terminal } from '@gravity-ui/icons'
import { PluginIcon } from '../../../settings/plugins/components/PluginIcon.tsx'
import { McpIcon } from '../../../settings/mcp/components/McpIcon.tsx'
import {
  COMPOSER_CAPABILITY_KIND,
  type ComposerCapabilityKind,
} from '@oh-my-harness/shared'

const ICONS = {
  [COMPOSER_CAPABILITY_KIND.ATTACHMENT]: FilePlus,
  [COMPOSER_CAPABILITY_KIND.COMMAND]: Terminal,
  [COMPOSER_CAPABILITY_KIND.SKILL]: BookOpen,
}

/** 按稳定能力身份展示图标，菜单、草稿和历史消息保持一致。 */
export function ComposerCapabilityIcon({
  kind,
  sourceId,
  className,
}: {
  kind: ComposerCapabilityKind
  sourceId?: string
  className: string
}) {
  if (kind === COMPOSER_CAPABILITY_KIND.PLUGIN)
    return (
      <PluginIcon installationId={sourceId} composer className={className} />
    )
  if (kind === COMPOSER_CAPABILITY_KIND.MCP)
    return <McpIcon serverId={sourceId} className={className} />
  const Icon = ICONS[kind]
  return <Icon aria-hidden className={className} />
}
