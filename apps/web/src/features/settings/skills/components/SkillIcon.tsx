import { BookOpen } from '@gravity-ui/icons'
import { PluginIcon } from '../../plugins/components/PluginIcon.tsx'
import { useCapabilitySettings } from '../../providers/contexts/capability-settings-context.ts'

/** 复用目录的插件归属，让技能列表、选择菜单和消息标签显示一致。 */
export function SkillIcon({
  skillId,
  composer = false,
  className = 'size-5 text-muted',
}: {
  skillId?: string
  composer?: boolean
  className?: string
}) {
  const { skills } = useCapabilitySettings()
  const pluginId = skills.find((skill) => skill.id === skillId)?.pluginId

  return pluginId ? (
    <PluginIcon
      installationId={pluginId}
      composer={composer}
      className={className}
    />
  ) : (
    <BookOpen aria-hidden className={className} />
  )
}
