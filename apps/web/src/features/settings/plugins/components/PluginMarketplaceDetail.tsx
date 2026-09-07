import { ArrowLeft, Check, LoaderCircle, Puzzle, Store } from 'lucide-react'
import { Button } from '@heroui/react'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import type { MarketplaceVo } from '../api/plugin-api.ts'

/** 市场详情是独立的下一级视图，市场管理与所属插件列表分区展示。 */
export function PluginMarketplaceDetail({
  market,
  query,
  busy,
  installingEntry,
  onBack,
  onRefresh,
  onRemove,
  onInstall,
}: {
  market: MarketplaceVo
  query: string
  busy: boolean
  installingEntry: string | null
  onBack(): void
  onRefresh(): void
  onRemove(): void
  onInstall(entry: MarketplaceVo['entries'][number]): void
}) {
  const entries = market.entries.filter((entry) =>
    `${entry.name} ${entry.description}`.toLowerCase().includes(query),
  )
  return (
    <section
      aria-label={`${market.displayName} 市场详情`}
      className="flex flex-col gap-5"
    >
      <Button
        className="h-7 min-h-0 w-fit gap-1.5 px-0 text-xs text-muted"
        variant="ghost"
        onPress={onBack}
      >
        <ArrowLeft className="size-3.5" />
        返回市场列表
      </Button>
      <header className="flex flex-col gap-3 border-b border-divider pb-5">
        <div className="flex items-center gap-2">
          <Store className="size-5 text-muted" />
          <h3 className="text-base font-medium text-foreground">
            {market.displayName}
          </h3>
        </div>
        <p className="break-all text-xs text-muted">{market.source}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
            variant="outline"
            isDisabled={busy}
            onPress={onRefresh}
          >
            刷新市场
          </Button>
          <Button
            className="h-7 min-h-0 rounded-full !px-2.5 !text-xs text-danger"
            variant="outline"
            isDisabled={busy}
            onPress={onRemove}
          >
            移除市场
          </Button>
        </div>
      </header>
      <section aria-label="此市场的插件" className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-foreground">
          此市场的插件{' '}
          <span className="ml-1 font-normal text-muted">
            {market.entries.length}
          </span>
        </h4>
        {!entries.length ? (
          <p role="status" className="text-sm text-muted">
            {query ? '没有匹配的插件。' : '此市场暂无插件。'}
          </p>
        ) : null}
        {entries.map((entry) => (
          <SettingsItemCard
            key={entry.id}
            icon={<Puzzle className="size-4 text-muted" />}
            title={entry.name}
            description={
              entry.description ||
              entry.compatibility.map((issue) => issue.message).join('；') ||
              (entry.installationId
                ? '已安装，可在插件页管理'
                : '安装后可在插件页启用')
            }
            actions={
              <Button
                className={`h-7 min-h-0 rounded-full !px-2.5 !text-xs ${entry.installationId ? 'text-success' : ''}`}
                variant="outline"
                isDisabled={busy || !entry.available || !!entry.installationId}
                onPress={() => onInstall(entry)}
              >
                {entry.installationId ? (
                  <>
                    <Check className="size-3.5" />
                    已安装
                  </>
                ) : installingEntry === `${market.id}:${entry.id}` ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                    安装中…
                  </>
                ) : (
                  '安装'
                )}
              </Button>
            }
          />
        ))}
      </section>
    </section>
  )
}
