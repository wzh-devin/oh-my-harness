import { APPROVAL_DECISION } from '@oh-my-harness/agent-policy/contracts'
import { CHAT_TOOL_KIND } from '@oh-my-harness/shared'
import { PromptInput } from '@agile-avocation/ui-pro/prompt-input'
import { useEffect, useState } from 'react'
import { Button, Dropdown, buttonVariants } from '@heroui/react'
import {
  ChevronDownIcon,
  FileTextIcon,
  HandIcon,
  PencilIcon,
  TerminalIcon,
} from 'lucide-react'
import type { ChatMessageTool } from '../../types/chat-types.ts'
import type { ApprovalDecision } from '../types/approval.ts'
import { getToolApprovalPresentation } from '../utils/tool-display.ts'

interface ApprovalPromptProps {
  canApproveSession: boolean
  permissionLabel: string
  tool: ChatMessageTool
  onResolve: (decision: ApprovalDecision) => void
  onStop: () => void
}

/** 在输入区展示当前待处理工具的权限请求。 */
export function ApprovalPrompt({
  canApproveSession,
  permissionLabel,
  tool,
  onResolve,
  onStop,
}: ApprovalPromptProps) {
  const [selectedDecision, setSelectedDecision] = useState<ApprovalDecision>(
    APPROVAL_DECISION.APPROVE_ONCE,
  )
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      // 编辑设置或输入内容时，回车与 Escape 只属于当前控件。
      if (
        event.defaultPrevented ||
        document.querySelector('[role=dialog]') ||
        document.querySelector('[role=menu]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,button,[role=menuitem],[contenteditable=true]',
          ))
      )
        return
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve(APPROVAL_DECISION.REJECT)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onResolve(selectedDecision)
      }
    }

    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [onResolve, selectedDecision])

  const presentation = getToolApprovalPresentation(tool)
  const ApprovalIcon =
    tool.kind === CHAT_TOOL_KIND.COMMAND
      ? TerminalIcon
      : tool.kind === CHAT_TOOL_KIND.READ
        ? FileTextIcon
        : tool.kind === CHAT_TOOL_KIND.EDIT
          ? PencilIcon
          : HandIcon

  return (
    <PromptInput className="w-full" value="" variant="primary">
      <PromptInput.Shell
        aria-labelledby="tool-approval-title"
        className="min-h-[7.5rem] !cursor-default"
      >
        <PromptInput.Content className="px-4 pt-4 pb-2">
          <div className="flex items-start justify-between gap-4">
            <h2
              className="min-w-0 pt-1 text-base font-normal text-foreground"
              id="tool-approval-title"
            >
              {presentation.question}
            </h2>
            <Button
              className="h-8 min-h-0 shrink-0 rounded-lg bg-transparent px-2 text-sm font-normal text-muted hover:bg-surface-secondary hover:text-foreground"
              size="sm"
              type="button"
              variant="ghost"
              onPress={onStop}
            >
              停止本轮
            </Button>
          </div>

          {presentation.target ? (
            <pre className="mt-3 max-h-28 overflow-auto rounded-lg bg-surface-secondary px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground/85 sm:text-sm">
              {presentation.target}
            </pre>
          ) : null}
        </PromptInput.Content>

        <PromptInput.Toolbar className="!static flex-wrap !items-end gap-2 px-4 pt-2 pb-3 @sm:gap-4">
          <PromptInput.ToolbarStart className="min-w-0 flex-1 flex-wrap !gap-1 text-sm text-muted @sm:!gap-2">
            <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2">
              <ApprovalIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{presentation.label}</span>
              <span aria-hidden className="text-divider">
                ·
              </span>
              <span className="truncate">本轮：{permissionLabel}</span>
            </span>
          </PromptInput.ToolbarStart>

          <PromptInput.ToolbarEnd className="shrink-0 gap-2">
            <Button
              className="h-9 min-h-0 rounded-full px-3.5 text-sm"
              size="sm"
              type="button"
              variant="outline"
              onPress={() => onResolve(APPROVAL_DECISION.REJECT)}
            >
              拒绝
            </Button>

            <div className="inline-flex items-stretch">
              <Button
                className={`h-9 min-h-0 px-3.5 text-sm ${canApproveSession ? 'rounded-l-full rounded-r-none' : 'rounded-full'}`}
                size="sm"
                type="button"
                variant="primary"
                onPress={() => onResolve(selectedDecision)}
              >
                {selectedDecision === APPROVAL_DECISION.APPROVE_SESSION
                  ? '允许此对话'
                  : '允许一次'}
              </Button>
              {canApproveSession ? (
                <Dropdown>
                  <Dropdown.Trigger
                    aria-label="选择允许方式"
                    className={buttonVariants({
                      variant: 'primary',
                      size: 'sm',
                      className:
                        'h-9 min-h-0 rounded-l-none rounded-r-full border-l border-white/25 px-2',
                    })}
                  >
                    <ChevronDownIcon aria-hidden className="size-4" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover
                    className="min-w-56 w-[min(21rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)]"
                    placement="top end"
                  >
                    <Dropdown.Menu
                      aria-label="允许方式"
                      selectionMode="single"
                      selectedKeys={[selectedDecision]}
                      onAction={(key) => {
                        if (
                          key === APPROVAL_DECISION.APPROVE_ONCE ||
                          key === APPROVAL_DECISION.APPROVE_SESSION
                        )
                          setSelectedDecision(key)
                      }}
                    >
                      <Dropdown.Item
                        id={APPROVAL_DECISION.APPROVE_ONCE}
                        textValue="允许一次"
                      >
                        允许一次
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                      <Dropdown.Item
                        id={APPROVAL_DECISION.APPROVE_SESSION}
                        textValue="允许此对话"
                      >
                        允许此对话
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              ) : null}
            </div>
          </PromptInput.ToolbarEnd>
        </PromptInput.Toolbar>
      </PromptInput.Shell>
    </PromptInput>
  )
}
