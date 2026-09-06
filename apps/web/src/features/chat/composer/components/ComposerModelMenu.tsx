import { ChevronDown, Cloud, Cpu, Sparkles } from '@gravity-ui/icons'
import { Dropdown } from '@heroui/react'
import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg'
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek.svg'
import googleIcon from '@lobehub/icons-static-svg/icons/google.svg'
import minimaxIcon from '@lobehub/icons-static-svg/icons/minimax.svg'
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg'
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg'
import zaiIcon from '@lobehub/icons-static-svg/icons/zai.svg'
import type {
  ModelThinkingLevel,
  SelectableModelGroup,
} from '../../../settings/index.ts'

interface ComposerModelMenuProps {
  groups: readonly SelectableModelGroup[]
  isDisabled: boolean
  selectedKey: string
  selectedName?: string
  selectedThinkingLevel: ModelThinkingLevel
  onChange: (key: string) => void
  onThinkingLevelChange: (level: ModelThinkingLevel) => void
}

const THINKING_LEVEL_LABELS: Record<ModelThinkingLevel, string> = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

const PROVIDER_ICONS: Readonly<Record<string, string>> = {
  anthropic: anthropicIcon,
  deepseek: deepseekIcon,
  google: googleIcon,
  'minimax-cn': minimaxIcon,
  'moonshotai-cn': moonshotIcon,
  openai: openaiIcon,
  'openai-codex': openaiIcon,
  openrouter: openrouterIcon,
  'zai-coding-cn': zaiIcon,
}

function ModelProviderIcon({
  className,
  providerId,
}: {
  className: string
  providerId?: string
}) {
  const icon = providerId ? PROVIDER_ICONS[providerId] : undefined
  if (!icon) return <Cloud aria-hidden className={`${className} text-muted`} />

  return (
    <img
      alt=""
      aria-hidden
      className={`shrink-0 object-contain opacity-70 ${className}`}
      src={icon}
    />
  )
}

/** 选择当前消息使用的模型与该模型支持的推理强度。 */
export function ComposerModelMenu({
  groups,
  isDisabled,
  selectedKey,
  selectedName,
  selectedThinkingLevel,
  onChange,
  onThinkingLevelChange,
}: ComposerModelMenuProps) {
  const selectedGroup = groups.find((group) =>
    group.models.some((model) => model.key === selectedKey),
  )
  const selectedModel = selectedGroup?.models.find(
    (model) => model.key === selectedKey,
  )
  const thinkingLevels = selectedModel?.thinkingLevels ?? ['off']
  const supportsThinking = thinkingLevels.some((level) => level !== 'off')
  const thinkingLabel = THINKING_LEVEL_LABELS[selectedThinkingLevel]

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={`模型服务商：${selectedGroup?.name ?? '暂无可用模型服务商'}，模型：${selectedName ?? '暂无可用模型'}${supportsThinking ? `，推理强度：${thinkingLabel}` : ''}`}
        className="flex h-8 min-w-16 max-w-fit flex-1 items-center gap-1.5 rounded-lg bg-transparent px-2 !text-sm text-muted outline-none transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus @lg:min-w-40"
        isDisabled={isDisabled}
      >
        <ModelProviderIcon
          className="hidden size-3.5 @sm:block"
          providerId={selectedGroup?.id}
        />
        <span className="min-w-0 truncate" title={selectedName}>
          {selectedName ?? '暂无可用模型'}
        </span>
        {supportsThinking ? (
          <span className="hidden shrink-0 text-muted @lg:inline">
            思考：{selectedThinkingLevel === 'off' ? '关' : thinkingLabel}
          </span>
        ) : null}
        <ChevronDown className="size-3 shrink-0 text-muted" />
      </Dropdown.Trigger>

      <Dropdown.Popover
        className="min-w-56 w-[min(18rem,calc(100vw-1.5rem))]"
        placement="top start"
      >
        <Dropdown.Menu
          aria-label="模型与推理设置"
          renderEmptyState={() => (
            <p className="px-3 py-2 text-sm text-muted">请先在设置中添加模型</p>
          )}
        >
          {groups.length > 0 ? (
            <>
              <Dropdown.SubmenuTrigger>
                <Dropdown.Item
                  id="provider"
                  className="whitespace-nowrap"
                  textValue="模型服务商"
                >
                  <ModelProviderIcon
                    className="size-4"
                    providerId={selectedGroup?.id}
                  />
                  <span className="shrink-0">模型服务商</span>
                  <span className="ml-auto min-w-0 truncate text-muted">
                    {selectedGroup?.name}
                  </span>
                  <Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover className="min-w-48 w-[min(16rem,calc(100vw-1.5rem))]">
                  <Dropdown.Menu
                    aria-label="模型服务商"
                    selectedKeys={selectedGroup ? [selectedGroup.id] : []}
                    selectionMode="single"
                    onAction={(key) =>
                      onChange(
                        groups.find((group) => group.id === String(key))
                          ?.models[0]?.key ?? selectedKey,
                      )
                    }
                  >
                    {groups.map((group) => (
                      <Dropdown.Item
                        key={group.id}
                        id={group.id}
                        textValue={group.name}
                      >
                        <ModelProviderIcon
                          className="size-4"
                          providerId={group.id}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {group.name}
                        </span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>

              <Dropdown.SubmenuTrigger>
                <Dropdown.Item
                  id="model"
                  className="whitespace-nowrap"
                  textValue="模型"
                >
                  <Cpu className="size-4 shrink-0 text-muted" />
                  <span className="shrink-0">模型</span>
                  <span className="ml-auto min-w-0 truncate text-muted">
                    {selectedName}
                  </span>
                  <Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover className="min-w-56 w-[min(20rem,calc(100vw-1.5rem))]">
                  <Dropdown.Menu
                    aria-label={`${selectedGroup?.name ?? ''} 模型`}
                    selectedKeys={[selectedKey]}
                    selectionMode="single"
                    onAction={(key) => onChange(String(key))}
                  >
                    {(selectedGroup?.models ?? []).map((model) => (
                      <Dropdown.Item
                        key={model.key}
                        id={model.key}
                        textValue={model.name}
                      >
                        <Cpu className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">
                          {model.name}
                        </span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
            </>
          ) : null}

          {supportsThinking ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item
                id="thinking-level"
                className="whitespace-nowrap"
                textValue="推理强度"
              >
                <Sparkles className="size-4 shrink-0 text-muted" />
                <span className="shrink-0">推理强度</span>
                <span className="ml-auto text-muted">{thinkingLabel}</span>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="w-36 min-w-36">
                <Dropdown.Menu
                  aria-label="推理强度"
                  selectedKeys={[selectedThinkingLevel]}
                  selectionMode="single"
                  onAction={(key) =>
                    onThinkingLevelChange(key as ModelThinkingLevel)
                  }
                >
                  {thinkingLevels.map((level) => (
                    <Dropdown.Item
                      key={level}
                      id={level}
                      textValue={THINKING_LEVEL_LABELS[level]}
                    >
                      <span className="flex-1">
                        {THINKING_LEVEL_LABELS[level]}
                      </span>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : groups.length > 0 ? (
            <Dropdown.Item
              id="thinking-level"
              className="whitespace-nowrap"
              isDisabled
              textValue="推理强度：不可用"
            >
              <Sparkles className="size-4 shrink-0 text-muted" />
              <span className="shrink-0">推理强度</span>
              <span className="ml-auto text-muted">不可用</span>
            </Dropdown.Item>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
