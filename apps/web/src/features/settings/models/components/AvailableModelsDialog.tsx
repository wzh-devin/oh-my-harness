import { useState } from 'react'
import { Button, Card, Checkbox, CheckboxGroup, Modal } from '@heroui/react'
import type { ProviderModelConfig } from '../data/provider-models.ts'

interface AvailableModelsDialogProps {
  candidates: readonly ProviderModelConfig[]
  currentModels: readonly ProviderModelConfig[]
  onClose: () => void
  onConfirm: (models: ProviderModelConfig[]) => void
}

/** 让用户从当前提供方的候选目录中多选要加入的模型。 */
export function AvailableModelsDialog({
  candidates,
  currentModels,
  onClose,
  onConfirm,
}: AvailableModelsDialogProps) {
  const configuredIds = new Set(currentModels.map((model) => model.id))
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  /** 将本次勾选的候选模型交给父级合并后关闭弹窗。 */
  const confirmSelection = () => {
    const selectedIdSet = new Set(selectedIds)
    onConfirm(candidates.filter((model) => selectedIdSet.has(model.id)))
  }

  return (
    <Modal.Backdrop
      isDismissable
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm"
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <Modal.Container
        className="w-full max-w-[calc(100vw-24px)] p-0 sm:max-w-[520px]"
        placement="center"
      >
        <Modal.Dialog className="w-full max-w-none gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-2xl outline-none">
          <Modal.CloseTrigger
            aria-label="关闭模型选择"
            className="bg-transparent text-foreground hover:bg-surface-secondary"
          />
          <Modal.Header className="flex flex-col items-start gap-1 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
            <Modal.Heading className="text-lg font-medium text-foreground">
              选择可用模型
            </Modal.Heading>
            <p className="text-sm leading-5 text-muted">
              选择要添加到当前提供方模型目录中的模型。
            </p>
          </Modal.Header>

          <Modal.Body className="!m-0 !w-full px-5 py-0 sm:px-6">
            {candidates.length === 0 ? (
              <Card
                className="rounded-xl border border-dashed border-divider px-4 py-8 text-center text-sm text-muted shadow-none"
                variant="transparent"
              >
                当前提供方暂无可用模型，可关闭弹窗后手动添加。
              </Card>
            ) : (
              <CheckboxGroup
                aria-label="可用模型"
                className="max-h-[min(320px,calc(100dvh-220px))] gap-2 overflow-y-auto overscroll-contain pr-1 **:data-[slot=checkbox]:mt-0"
                value={selectedIds}
                variant="secondary"
                onChange={setSelectedIds}
              >
                {candidates.map((model) => {
                  const isConfigured = configuredIds.has(model.id)

                  return (
                    <Checkbox
                      key={model.id}
                      isDisabled={isConfigured}
                      value={model.id}
                    >
                      <Checkbox.Content className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-secondary">
                        <Checkbox.Control className="shrink-0 before:bg-foreground">
                          <Checkbox.Indicator className="**:data-[slot=checkbox-default-indicator--checkmark]:text-background" />
                        </Checkbox.Control>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="break-all font-mono text-sm text-foreground">
                            {model.id}
                          </span>
                          {model.name && model.name !== model.id ? (
                            <span className="mt-0.5 truncate text-xs text-muted">
                              {model.name}
                            </span>
                          ) : null}
                          {model.maxOutputTokensLimit !== undefined ? (
                            <span className="mt-0.5 text-xs text-muted">
                              最大输出{' '}
                              {model.maxOutputTokensLimit.toLocaleString()}{' '}
                              Token
                            </span>
                          ) : null}
                        </span>
                        {isConfigured ? (
                          <span className="shrink-0 text-xs text-muted">
                            已添加
                          </span>
                        ) : null}
                      </Checkbox.Content>
                    </Checkbox>
                  )
                })}
              </CheckboxGroup>
            )}
          </Modal.Body>

          <Modal.Footer className="flex justify-end gap-2 px-5 pt-5 pb-5 sm:px-6 sm:pb-6">
            <Button type="button" variant="outline" onPress={onClose}>
              取消
            </Button>
            <Button
              isDisabled={selectedIds.length === 0}
              className="bg-foreground text-background hover:bg-foreground/90"
              type="button"
              onPress={confirmSelection}
            >
              添加所选模型（{selectedIds.length}）
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
