import { useState } from 'react'
import { Plus } from '@gravity-ui/icons'
import { Button, FieldError, Input, Label, TextField } from '@heroui/react'
import {
  mergeProviderModels,
  type ProviderModelConfig,
} from '../data/provider-models.ts'
import { getProviderModels } from '../api/index.ts'
import { AvailableModelsDialog } from './AvailableModelsDialog.tsx'

interface ProviderModelCatalogProps {
  canLoadAvailableModels?: boolean
  providerId: string
  value: ProviderModelConfig[]
  onChange: (models: ProviderModelConfig[]) => void
}

/** 管理提供方表单中的本地模型目录。 */
export function ProviderModelCatalog({
  canLoadAvailableModels = true,
  providerId,
  value,
  onChange,
}: ProviderModelCatalogProps) {
  const [catalogMessage, setCatalogMessage] = useState('')
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false)
  const [availableModels, setAvailableModels] = useState<
    ProviderModelConfig[] | null
  >(null)

  /** 从服务端 Pi AI 目录加载尚未添加的模型。 */
  const loadAvailableModels = async () => {
    if (!canLoadAvailableModels || isLoadingCatalog) return
    setCatalogMessage('')
    setIsLoadingCatalog(true)
    try {
      const models = await getProviderModels(providerId)
      const configuredIds = new Set(value.map((model) => model.id))
      const missingModels = models.filter(
        (model) => !configuredIds.has(model.id),
      )
      if (missingModels.length === 0) {
        setCatalogMessage(
          `已从 Pi AI 获取 ${models.length} 个模型，当前目录已是最新。`,
        )
        return
      }
      setAvailableModels(missingModels)
    } catch (error) {
      setCatalogMessage((error as Error).message)
    } finally {
      setIsLoadingCatalog(false)
    }
  }

  const updateModel = (
    index: number,
    field: 'id' | 'name',
    nextValue: string,
  ) => {
    setCatalogMessage('')
    onChange(
      value.map((model, modelIndex) => {
        if (modelIndex !== index) return model
        if (field !== 'id') return { ...model, [field]: nextValue }
        const shouldSyncName = !model.name.trim() || model.name === model.id
        return {
          ...model,
          id: nextValue,
          name: shouldSyncName ? nextValue : model.name,
        }
      }),
    )
  }

  const updateMaxOutputTokens = (index: number, nextValue: string) => {
    setCatalogMessage('')
    onChange(
      value.map((model, modelIndex) =>
        modelIndex === index
          ? {
              ...model,
              maxOutputTokens: nextValue === '' ? undefined : Number(nextValue),
            }
          : model,
      ),
    )
  }

  const addSelectedModels = (selectedModels: ProviderModelConfig[]) => {
    onChange(
      mergeProviderModels(
        value,
        selectedModels.map((model) => ({ ...model })),
      ),
    )
    setCatalogMessage('')
    setAvailableModels(null)
  }

  return (
    <div className="border-t border-divider pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">模型目录</h4>
          <p className="mt-1 text-xs text-muted">
            已添加 {value.length} 个模型
          </p>
        </div>
        <Button
          isDisabled={!canLoadAvailableModels || isLoadingCatalog}
          className="h-8 min-h-0 shrink-0 rounded-full px-3 text-xs"
          type="button"
          variant="outline"
          onPress={() => void loadAvailableModels()}
        >
          {isLoadingCatalog ? '获取中…' : '获取可用模型'}
        </Button>
      </div>

      <div className="mt-3">
        {value.length === 0 ? (
          <p className="rounded-xl border border-dashed border-divider px-4 py-4 text-center text-xs leading-5 text-muted shadow-none">
            尚未添加模型，保存后该提供方不会出现在模型选择器中。
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,0.8fr)_auto] items-center gap-2 px-1 pb-1.5 text-xs font-medium text-muted sm:grid">
              <span>
                模型 ID <span className="text-danger">*</span>
              </span>
              <span>显示名称</span>
              <span>最大输出 Token</span>
              <span className="w-14" aria-hidden />
            </div>
            <div className="divide-y divide-divider">
              {value.map((model, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,0.8fr)_auto] sm:items-start"
                >
                  <TextField isRequired aria-label={`模型 ID ${index + 1}`}>
                    <Label className="text-xs text-muted sm:sr-only">
                      模型 ID
                    </Label>
                    <Input
                      placeholder="例如 deepseek-chat"
                      value={model.id}
                      variant="secondary"
                      onChange={(event) =>
                        updateModel(index, 'id', event.target.value)
                      }
                    />
                    <FieldError />
                  </TextField>
                  <TextField aria-label={`显示名称 ${index + 1}`}>
                    <Label className="text-xs text-muted sm:sr-only">
                      显示名称
                    </Label>
                    <Input
                      placeholder="可选"
                      value={model.name}
                      variant="secondary"
                      onChange={(event) =>
                        updateModel(index, 'name', event.target.value)
                      }
                    />
                  </TextField>
                  <TextField
                    aria-label={`最大输出 Token ${index + 1}`}
                    isInvalid={
                      model.maxOutputTokens !== undefined &&
                      (!Number.isSafeInteger(model.maxOutputTokens) ||
                        model.maxOutputTokens <= 0 ||
                        (model.maxOutputTokensLimit !== undefined &&
                          model.maxOutputTokens > model.maxOutputTokensLimit))
                    }
                  >
                    <Label className="text-xs text-muted sm:sr-only">
                      最大输出 Token
                    </Label>
                    <Input
                      max={model.maxOutputTokensLimit}
                      min={1}
                      placeholder="使用模型上限"
                      step={1}
                      type="number"
                      value={model.maxOutputTokens?.toString() ?? ''}
                      variant="secondary"
                      onChange={(event) =>
                        updateMaxOutputTokens(index, event.target.value)
                      }
                    />
                    <FieldError>
                      {model.maxOutputTokensLimit === undefined
                        ? '请输入正整数。'
                        : `请输入 1–${model.maxOutputTokensLimit.toLocaleString()}。`}
                    </FieldError>
                    <p className="px-1 text-[11px] leading-4 text-muted">
                      {model.maxOutputTokensLimit === undefined
                        ? '留空使用模型上限。'
                        : `留空使用模型上限 ${model.maxOutputTokensLimit.toLocaleString()}。`}
                    </p>
                  </TextField>
                  <Button
                    className="h-9 min-h-0 w-fit justify-self-start rounded-full px-3 text-xs sm:justify-self-auto"
                    type="button"
                    variant="outline"
                    onPress={() => {
                      setCatalogMessage('')
                      onChange(
                        value.filter((_, modelIndex) => modelIndex !== index),
                      )
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {catalogMessage ? (
        <p aria-live="polite" className="mt-2 text-xs text-muted">
          {catalogMessage}
        </p>
      ) : null}

      <Button
        className="mt-3 h-8 min-h-0 rounded-full px-3 text-xs"
        type="button"
        variant="outline"
        onPress={() => {
          setCatalogMessage('')
          onChange([...value, { id: '', name: '' }])
        }}
      >
        <Plus className="size-3.5" />
        添加模型
      </Button>

      {availableModels !== null ? (
        <AvailableModelsDialog
          candidates={availableModels}
          currentModels={value}
          onClose={() => setAvailableModels(null)}
          onConfirm={addSelectedModels}
        />
      ) : null}
    </div>
  )
}
