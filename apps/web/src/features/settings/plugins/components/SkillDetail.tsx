import { AGENT_CAPABILITY_SOURCE } from '@oh-my-harness/shared'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@heroui/react'
import { useSkillDetail } from '../hooks/use-skill-detail.ts'

/** 独立详情页展示技能原文；移除操作按用户技能与插件技能的归属分流。 */
export function SkillDetail({
  id,
  onBack,
  onDeleted,
  onManagePlugin,
}: {
  id: string
  onBack(): void
  onDeleted(message: string): void
  onManagePlugin(id: string): void
}) {
  const { detail, loading, busy, error, remove, retry } = useSkillDetail(
    id,
    onDeleted,
  )
  const [confirming, setConfirming] = useState(false)
  return (
    <section aria-label="技能详情" className="flex min-w-0 flex-col gap-5">
      <Button
        className="h-7 min-h-0 w-fit gap-1.5 px-0 text-xs text-muted"
        variant="ghost"
        onPress={onBack}
      >
        <ArrowLeft className="size-3.5" />
        返回技能列表
      </Button>
      {loading ? (
        <p role="status" className="text-sm text-muted">
          正在读取技能…
        </p>
      ) : null}
      {error ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          {!detail ? (
            <Button className="w-fit" variant="outline" onPress={retry}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail ? (
        <>
          <header className="flex flex-col gap-3 border-b border-divider pb-5">
            <h3 className="break-words text-base font-medium text-foreground">
              {detail.name}
            </h3>
            <p className="break-words text-sm text-muted">
              {detail.description}
            </p>
            <p className="text-xs text-muted">
              来源：
              {detail.source === AGENT_CAPABILITY_SOURCE.PLUGIN
                ? '插件'
                : 'oh-my-harness 独立技能'}
            </p>
            {detail.pluginId ? (
              <>
                <p className="text-xs text-muted">
                  此技能随插件安装，请通过所属插件管理或卸载。
                </p>
                <Button
                  className="h-8 min-h-0 w-fit rounded-full px-3 text-xs"
                  variant="outline"
                  onPress={() => onManagePlugin(detail.pluginId!)}
                >
                  管理所属插件
                </Button>
              </>
            ) : detail.canDelete ? (
              confirming ? (
                <div
                  className="flex flex-col gap-3"
                  role="group"
                  aria-label="确认删除技能"
                >
                  <p className="text-sm text-foreground">
                    确认删除「{detail.name}
                    」？删除后聊天中将无法选择，本地会保留可恢复副本。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="h-8 min-h-0 rounded-full px-3 text-xs"
                      variant="outline"
                      isDisabled={busy}
                      onPress={() => setConfirming(false)}
                    >
                      取消删除
                    </Button>
                    <Button
                      className="h-8 min-h-0 rounded-full px-3 text-xs"
                      variant="danger"
                      isDisabled={busy}
                      onPress={() => void remove()}
                    >
                      {busy ? '删除中…' : '确认删除'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="h-8 min-h-0 w-fit rounded-full px-3 text-xs text-danger"
                  variant="outline"
                  onPress={() => setConfirming(true)}
                >
                  删除技能
                </Button>
              )
            ) : (
              <p className="text-xs text-muted">
                根目录技能请手动管理，不能删除整个技能目录。
              </p>
            )}
          </header>
          <section
            aria-label="技能说明"
            className="flex min-w-0 flex-col gap-2"
          >
            <h4 className="text-sm font-medium text-foreground">技能说明</h4>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-3 text-xs leading-6 text-foreground">
              {detail.content}
            </pre>
          </section>
          <section
            aria-label="技能资源"
            className="flex min-w-0 flex-col gap-2"
          >
            <h4 className="text-sm font-medium text-foreground">技能资源</h4>
            <ul className="max-h-60 overflow-auto text-xs leading-6 text-muted">
              {detail.files.map((file) => (
                <li className="break-all" key={file}>
                  {file}
                </li>
              ))}
            </ul>
            {detail.filesTruncated ? (
              <p className="text-xs text-muted">
                资源较多，仅展示前 300 个条目。
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  )
}
