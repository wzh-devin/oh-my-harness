import { Package, Store } from 'lucide-react'
import { ResourceIcon } from '../../../../components/ui/index.ts'
import { pluginApi } from '../api/plugin-api.ts'

/** 安装身份优先于市场缓存，直接安装和历史提及共用包内真实图标。 */
export function PluginIcon({
  installationId,
  iconId,
  iconDarkId,
  market = false,
  composer = false,
  className,
}: {
  installationId?: string
  iconId?: string
  iconDarkId?: string
  market?: boolean
  composer?: boolean
  className?: string
}) {
  const Fallback = market ? Store : Package
  return (
    <ResourceIcon
      src={
        installationId
          ? pluginApi.installationIconUrl(installationId, false, composer)
          : iconId
            ? pluginApi.iconUrl(iconId)
            : undefined
      }
      darkSrc={
        installationId
          ? pluginApi.installationIconUrl(installationId, true, composer)
          : iconDarkId
            ? pluginApi.iconUrl(iconDarkId)
            : undefined
      }
      className={className}
      fallback={<Fallback className="size-full text-muted" />}
    />
  )
}
