import { BookOpen, Box, FilePlus, Terminal } from '@gravity-ui/icons'
import githubIcon from '@lobehub/icons-static-svg/icons/github.svg'
import mcpIcon from '@lobehub/icons-static-svg/icons/mcp.svg'
import {
  COMPOSER_CAPABILITY_KIND,
  type ComposerCapabilityKind,
} from '@oh-my-harness/shared'

const ICONS = {
  [COMPOSER_CAPABILITY_KIND.ATTACHMENT]: FilePlus,
  [COMPOSER_CAPABILITY_KIND.COMMAND]: Terminal,
  [COMPOSER_CAPABILITY_KIND.SKILL]: BookOpen,
  [COMPOSER_CAPABILITY_KIND.PLUGIN]: Box,
}

export function ComposerCapabilityIcon({
  kind,
  label,
  className,
}: {
  kind: ComposerCapabilityKind
  label: string
  className: string
}) {
  if (kind === COMPOSER_CAPABILITY_KIND.MCP)
    return (
      <img
        alt=""
        src={label.toLowerCase() === 'github' ? githubIcon : mcpIcon}
        className={`${className} dark:invert`}
      />
    )
  const Icon = ICONS[kind]
  return <Icon aria-hidden className={className} />
}
