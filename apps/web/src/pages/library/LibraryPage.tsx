import { EmptyState } from '@agile-avocation/ui-pro/empty-state'

export function LibraryPage() {
  return (
    <div className="grid h-full min-h-0 place-items-center overflow-y-auto px-4 py-8">
      <EmptyState size="sm">
        <EmptyState.Header>
          <EmptyState.Title>资料库尚未开放</EmptyState.Title>
          <EmptyState.Description>
            当前尚不支持保存和管理资料。
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    </div>
  )
}
