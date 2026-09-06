import type {
  ChangeEvent,
  CompositionEvent,
  KeyboardEvent,
  SyntheticEvent,
} from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatStatus } from '@agile-avocation/ui-pro/prompt-input'
import { PromptInput } from '@agile-avocation/ui-pro/prompt-input'
import { Bulb, Folder, Terminal } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { SelectMenu } from '../../../../components/ui/index.ts'
import {
  type PermissionId,
  getSelectableModelGroups,
  resolveModelThinkingLevel,
  resolveModelSelectionKey,
  useModelSettings,
  usePermissionSettings,
  usePluginSettings,
} from '../../../settings/index.ts'
import {
  addComposerContextItem,
  createComposerContextItem,
  findComposerTrigger,
  getComposerContextUnavailableReason,
  getComposerCapabilityGroups,
  isComposerModeContext,
  removeComposerRange,
  type ComposerCapability,
  type ComposerContextItem,
  type ComposerMenuMode,
} from '../capabilities/composer-capabilities.ts'
import { useChatWorkspace } from '../../workspace/contexts/workspace-context.ts'
import { resolveComposerWorkspace } from '../../workspace/data/workspace-data.ts'
import type { ChatSubmitPayload } from '../types/chat-composer.ts'
import { ComposerCapabilityMenu } from './ComposerCapabilityMenu.tsx'
import { ComposerContextBar } from './ComposerContextBar.tsx'
import { ComposerModelMenu } from './ComposerModelMenu.tsx'
import { ComposerPermissionMenu } from './ComposerPermissionMenu.tsx'
import { ChatAttachmentList } from './ChatAttachmentList.tsx'
import { ContextUsageMeter } from './ContextUsageMeter.tsx'
import type { ChatContextUsage } from '../../data/index.ts'

interface PendingAttachment {
  file: File
  id: string
  mimeType: string
  name: string
  src?: string
}

interface ComposerMenuState {
  end?: number
  mode: ComposerMenuMode
  query: string
  start?: number
}

interface ChatComposerProps {
  activePermission?: PermissionId
  className?: string
  contextUsage?: ChatContextUsage
  error?: string
  fixedWorkspaceId?: string
  initialModelId?: string
  initialModelKey?: string
  isDisabled?: boolean
  status?: ChatStatus
  value: string
  onModelChange?: (
    selection: Pick<ChatSubmitPayload, 'modelId' | 'providerId'>,
  ) => boolean | Promise<boolean>
  onStop?: () => void
  onSubmit: (payload: ChatSubmitPayload) => boolean | Promise<boolean>
  onValueChange: (value: string) => void
}

const createAttachmentId = (file: File) =>
  `${file.name}-${file.lastModified}-${crypto.randomUUID()}`

const revokeAttachmentUrl = (attachment: PendingAttachment) => {
  if (attachment.src?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.src)
  }
}

/** 管理消息草稿、模型和可选能力；运行状态由会话协调层控制。 */
export function ChatComposer({
  activePermission,
  className,
  contextUsage,
  error,
  fixedWorkspaceId,
  initialModelId = 'gpt-5.4',
  initialModelKey,
  isDisabled = false,
  onModelChange,
  onSubmit,
  onStop,
  onValueChange,
  status = 'ready',
  value,
}: ChatComposerProps) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0)
  const [contextItems, setContextItems] = useState<ComposerContextItem[]>([])
  const [menuState, setMenuState] = useState<ComposerMenuState | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [isModelUpdating, setIsModelUpdating] = useState(false)
  const { providers, setThinkingLevel, thinkingLevel } = useModelSettings()
  const { permission } = usePermissionSettings()
  const { commands, openPluginSettings, skills } = usePluginSettings()
  const { onWorkspaceSelect, selectedWorkspaceId, workspaces } =
    useChatWorkspace()
  const composerWorkspace = resolveComposerWorkspace(
    selectedWorkspaceId,
    fixedWorkspaceId,
  )
  const attachmentsRef = useRef<PendingAttachment[]>([])
  const composerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const promptInputShellRef = useRef<HTMLDivElement>(null)
  const submitPendingRef = useRef(false)
  const modelGroups = getSelectableModelGroups(providers)
  const selectableModels = modelGroups.flatMap((group) => group.models)
  const selectedModelKey = resolveModelSelectionKey(
    modelGroups,
    modelKey || initialModelKey || '',
    initialModelId,
  )
  const selectedModel = selectableModels.find(
    (model) => model.key === selectedModelKey,
  )
  const selectedProvider = modelGroups.find((group) =>
    group.models.some((model) => model.key === selectedModelKey),
  )
  const visibleContextUsage =
    contextUsage &&
    contextUsage.modelId === selectedModel?.id &&
    contextUsage.providerId === selectedProvider?.id
      ? contextUsage
      : undefined
  const selectedThinkingLevel = resolveModelThinkingLevel(
    selectedModel?.thinkingLevels ?? ['off'],
    thinkingLevel,
  )
  const capabilityGroups = menuState
    ? getComposerCapabilityGroups(
        menuState.mode,
        skills,
        commands,
        menuState.query,
      )
    : []
  const capabilities = capabilityGroups.flatMap((group) => group.items)
  const activeCapability = capabilities.length
    ? capabilities[activeCapabilityIndex % capabilities.length]
    : undefined
  const contextDisplayItems = contextItems.map((item) => ({
    ...item,
    unavailableReason: getComposerContextUnavailableReason(
      item,
      skills,
      commands,
    ),
  }))
  const hasUnavailableContext = contextDisplayItems.some(
    (item) => item.unavailableReason,
  )
  const activeMode = contextDisplayItems.find(isComposerModeContext)
  const transientContextItems = contextDisplayItems.filter(
    (item) => !isComposerModeContext(item),
  )
  const ActiveModeIcon = activeMode?.reference === '/plan' ? Bulb : Terminal

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeAttachmentUrl)
    }
  }, [])

  const handleStop = () => {
    onStop?.()
  }

  const handleSubmit = async () => {
    if (menuState || submitPendingRef.current) return

    const message = value.trim()

    if (
      status !== 'ready' ||
      isDisabled ||
      isModelUpdating ||
      !selectedModel ||
      !selectedProvider ||
      !workspaces.some(
        (workspace) =>
          workspace.id === composerWorkspace.workspaceId && workspace.available,
      ) ||
      hasUnavailableContext ||
      (!message &&
        attachments.length === 0 &&
        transientContextItems.length === 0)
    ) {
      return
    }

    submitPendingRef.current = true
    let accepted = false
    try {
      accepted = await onSubmit({
        attachments: attachments.map(({ file }) => file),
        contextItems,
        message,
        modelId: selectedModel.id,
        permission,
        providerId: selectedProvider.id,
        thinkingLevel: selectedThinkingLevel,
        workspaceId: composerWorkspace.workspaceId,
      })
    } finally {
      submitPendingRef.current = false
    }
    if (!accepted) return

    attachments.forEach(revokeAttachmentUrl)
    setAttachments([])
    setContextItems([])
    onValueChange('')
  }

  const handleModelChange = async (nextKey: string) => {
    if (nextKey === selectedModelKey || isModelUpdating) return
    const nextModel = selectableModels.find((model) => model.key === nextKey)
    const nextProvider = modelGroups.find((group) =>
      group.models.some((model) => model.key === nextKey),
    )
    if (!nextModel || !nextProvider) return

    const previousKey = selectedModelKey
    setModelKey(nextKey)
    if (!onModelChange) return

    setIsModelUpdating(true)
    let accepted = false
    try {
      accepted = await onModelChange({
        modelId: nextModel.id,
        providerId: nextProvider.id,
      })
    } finally {
      setIsModelUpdating(false)
    }
    if (!accepted) setModelKey(previousKey)
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])

    if (files.length > 0) {
      setAttachments((current) => [
        ...current,
        ...files.map((file) => ({
          file,
          id: createAttachmentId(file),
          mimeType: file.type,
          name: file.name,
          src: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        })),
      ])
    }

    event.currentTarget.value = ''
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id)
      if (removed) revokeAttachmentUrl(removed)
      return current.filter((attachment) => attachment.id !== id)
    })
  }

  const handleRemoveContext = (id: string) => {
    setContextItems((currentItems) =>
      currentItems.filter((item) => item.id !== id),
    )
  }

  const getTextArea = () =>
    composerRef.current?.querySelector<HTMLTextAreaElement>('textarea')

  const updateMenuFromTextArea = (textArea: HTMLTextAreaElement) => {
    if (isComposingRef.current) return

    const trigger = findComposerTrigger(
      textArea.value,
      textArea.selectionStart ?? textArea.value.length,
    )
    setActiveCapabilityIndex(0)
    setMenuState(
      trigger
        ? {
            end: trigger.end,
            mode: trigger.mode,
            query: trigger.query,
            start: trigger.start,
          }
        : null,
    )
  }

  const handleTextAreaEvent = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    updateMenuFromTextArea(event.currentTarget)
  }

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    isComposingRef.current = false
    updateMenuFromTextArea(event.currentTarget)
  }

  const handleCapabilitySelect = (capability: ComposerCapability) => {
    setMenuState(null)

    const textArea = getTextArea()
    const start = menuState?.start
    const end = menuState?.end
    const next =
      start == null || end == null
        ? {
            caret: textArea?.selectionStart ?? value.length,
            value,
          }
        : removeComposerRange(value, start, end)

    if (next.value !== value) onValueChange(next.value)

    if (capability.kind === 'attachment') {
      fileInputRef.current?.click()
      return
    }

    if (capability.settingsTab) {
      openPluginSettings(capability.settingsTab)
      return
    }

    const contextItem = createComposerContextItem(capability)
    if (!contextItem) return

    setContextItems((currentItems) =>
      addComposerContextItem(currentItems, contextItem),
    )
    window.requestAnimationFrame(() => {
      const currentTextArea = getTextArea()
      currentTextArea?.focus()
      currentTextArea?.setSelectionRange(next.caret, next.caret)
    })
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuState) {
      if (
        event.key === 'Backspace' &&
        value.length === 0 &&
        event.currentTarget.selectionStart === 0 &&
        transientContextItems.length > 0
      ) {
        event.preventDefault()
        setContextItems((currentItems) =>
          currentItems.at(-1)?.kind === 'command'
            ? currentItems
            : currentItems.slice(0, -1),
        )
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setMenuState(null)
      return
    }

    if (capabilities.length === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      setActiveCapabilityIndex(
        (current) =>
          (Math.min(current, capabilities.length - 1) +
            offset +
            capabilities.length) %
          capabilities.length,
      )
      return
    }

    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      if (!activeCapability) return
      event.preventDefault()
      handleCapabilitySelect(activeCapability)
      return
    }

    if (event.key === ' ') {
      const triggerReference = `${menuState.mode === 'slash' ? '/' : '@'}${menuState.query}`
      const exactCapability = capabilities.find(
        (capability) =>
          capability.contextReference?.toLocaleLowerCase() ===
          triggerReference.toLocaleLowerCase(),
      )
      if (!exactCapability) return

      event.preventDefault()
      handleCapabilitySelect(exactCapability)
    }
  }

  const isGenerating = status === 'submitted' || status === 'streaming'
  const canSend = Boolean(
    !isDisabled &&
    !isModelUpdating &&
    selectedModel &&
    workspaces.some(
      (workspace) =>
        workspace.id === composerWorkspace.workspaceId && workspace.available,
    ) &&
    !hasUnavailableContext &&
    (value.trim() || attachments.length || transientContextItems.length),
  )

  return (
    <div ref={composerRef} className={`@container ${className ?? 'w-full'}`}>
      {composerWorkspace.isSelectable ? (
        <div className="mb-3 flex h-8 items-center px-2">
          <SelectMenu
            ariaLabel="工作区"
            className="max-w-full"
            options={workspaces}
            startContent={<Folder className="size-4 shrink-0" />}
            triggerClassName="h-8 max-w-56 bg-transparent pl-1 text-sm hover:bg-surface-secondary"
            value={composerWorkspace.workspaceId}
            onChange={onWorkspaceSelect}
          />
        </div>
      ) : null}

      <PromptInput
        className="w-full"
        status={status}
        value={value}
        variant="primary"
        onStop={handleStop}
        onSubmit={handleSubmit}
        onValueChange={onValueChange}
      >
        <PromptInput.Shell ref={promptInputShellRef} className="min-h-[7.5rem]">
          <PromptInput.Content>
            {attachments.length > 0 ? (
              <PromptInput.Attachments>
                <ChatAttachmentList
                  attachments={attachments}
                  onRemove={(attachment) => {
                    if (attachment.id) handleRemoveAttachment(attachment.id)
                  }}
                />
              </PromptInput.Attachments>
            ) : null}

            {hasUnavailableContext ? (
              <p className="px-4 pt-1 text-xs text-danger" role="status">
                移除或重新启用不可用的上下文后再发送。
              </p>
            ) : null}

            {error ? (
              <p className="px-4 pt-1 text-xs text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div
              className={`flex min-w-0 items-start gap-2 px-4 pb-3 ${attachments.length > 0 || hasUnavailableContext ? 'pt-1' : 'pt-4'}`}
            >
              <ComposerContextBar
                className="max-w-[55%] shrink-0 sm:max-w-[60%]"
                isDisabled={isGenerating}
                items={transientContextItems}
                onRemove={handleRemoveContext}
              />
              <PromptInput.TextArea
                aria-label="消息输入"
                className="!m-0 !min-h-7 min-w-24 flex-1 !rounded-none !px-0 !pt-0 !pb-0 !text-base !leading-7"
                disabled={isDisabled}
                placeholder="你想了解什么？"
                onCompositionEnd={handleCompositionEnd}
                onCompositionStart={() => {
                  isComposingRef.current = true
                  setMenuState(null)
                }}
                onInput={handleTextAreaEvent}
                onKeyDown={handleComposerKeyDown}
                onSelect={handleTextAreaEvent}
              />
            </div>
          </PromptInput.Content>

          <PromptInput.Toolbar className="!static !items-end gap-2 px-4 pt-2 pb-3 @sm:gap-4">
            <PromptInput.ToolbarStart className="min-w-0 flex-1 flex-wrap !gap-1 @sm:!gap-2">
              <input
                ref={fileInputRef}
                aria-hidden
                multiple
                className="sr-only"
                disabled={isGenerating}
                tabIndex={-1}
                type="file"
                onChange={handleFileInputChange}
              />
              <ComposerCapabilityMenu
                activeId={activeCapability?.id}
                anchorRef={promptInputShellRef}
                groups={capabilityGroups}
                isDisabled={isGenerating}
                isOpen={Boolean(menuState)}
                onOpenChange={(open) => {
                  setActiveCapabilityIndex(0)
                  setMenuState(open ? { mode: 'plus', query: '' } : null)
                }}
                onSelect={handleCapabilitySelect}
              />
              <ComposerPermissionMenu
                activePermission={activePermission}
                isDisabled={isGenerating || isDisabled}
              />
              <ComposerModelMenu
                groups={modelGroups}
                isDisabled={isDisabled || isGenerating || isModelUpdating}
                selectedKey={selectedModelKey}
                selectedName={selectedModel?.name}
                selectedThinkingLevel={selectedThinkingLevel}
                onChange={(key) => void handleModelChange(key)}
                onThinkingLevelChange={setThinkingLevel}
              />
              {activeMode ? (
                <Button
                  aria-label={`关闭${activeMode.label}`}
                  className="h-8 min-w-0 shrink-0 gap-1.5 rounded-lg bg-transparent px-2 text-sm font-normal text-muted hover:bg-surface-secondary hover:text-foreground"
                  isDisabled={isGenerating}
                  size="sm"
                  variant="ghost"
                  onPress={() => handleRemoveContext(activeMode.id)}
                >
                  <ActiveModeIcon className="size-3.5 shrink-0" />
                  <span className="max-w-24 truncate">{activeMode.label}</span>
                </Button>
              ) : null}
            </PromptInput.ToolbarStart>

            <PromptInput.ToolbarEnd className="shrink-0 gap-2">
              {visibleContextUsage ? (
                <ContextUsageMeter usage={visibleContextUsage} />
              ) : null}
              <PromptInput.Send
                aria-label={isGenerating ? '停止生成' : '发送消息'}
                className="size-9 min-h-9 min-w-9"
                isDisabled={!canSend && !isGenerating}
              />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>

        <PromptInput.Footer>AI 可能会出错，请核对重要信息。</PromptInput.Footer>
      </PromptInput>
    </div>
  )
}
