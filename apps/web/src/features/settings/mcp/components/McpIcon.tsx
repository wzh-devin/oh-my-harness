import mcpIcon from '@lobehub/icons-static-svg/icons/mcp.svg'
import { ResourceIcon } from '../../../../components/ui/index.ts'
import { pluginApi } from '../../plugins/api/plugin-api.ts'

/** 由宿主按 MCP 归属解析真实插件图标，不按服务名称猜测品牌。 */
export function McpIcon({
  serverId,
  className = 'size-6',
}: {
  serverId?: string
  className?: string
}) {
  return (
    <ResourceIcon
      src={serverId ? pluginApi.mcpIconUrl(serverId) : undefined}
      darkSrc={serverId ? pluginApi.mcpIconUrl(serverId, true) : undefined}
      className={className}
      fallback={<img src={mcpIcon} alt="" className="size-full dark:invert" />}
    />
  )
}
