import { APPROVAL_DECISION } from '@oh-my-harness/agent-policy/contracts'
import { useEffect } from 'react'
import { Button, Kbd } from '@heroui/react'
import { FileTextIcon, HandIcon, PencilIcon, TerminalIcon } from 'lucide-react'
import type { ChatMessageTool } from '../../data/chat-types.ts'
import type { ApprovalDecision } from '../types/approval.ts'
import { getToolApprovalPresentation } from '../utils/tool-display.ts'

interface ApprovalPromptProps {
  tool: ChatMessageTool
  onResolve: (decision: ApprovalDecision) => void
}

/** 在聊天底栏展示当前待处理工具的 Codex 风格权限请求。 */
export function ApprovalPrompt({ tool, onResolve }: ApprovalPromptProps) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve(APPROVAL_DECISION.reject)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onResolve(APPROVAL_DECISION.approveOnce)
      }
    }

    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [onResolve])

  const presentation = getToolApprovalPresentation(tool)
  const ApprovalIcon =
    tool.kind === 'command'
      ? TerminalIcon
      : tool.kind === 'read'
        ? FileTextIcon
        : tool.kind === 'edit'
          ? PencilIcon
          : HandIcon

  return (
    <section
      aria-labelledby="tool-approval-title"
      className="rounded-xl border border-divider bg-surface px-4 py-4 sm:px-5"
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <ApprovalIcon aria-hidden className="size-4 shrink-0" />
        <span>{presentation.label}</span>
      </div>

      <h2
        className="mt-3 text-base font-semibold text-foreground"
        id="tool-approval-title"
      >
        {presentation.question}
      </h2>

      {presentation.target ? (
        <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-surface-secondary px-3.5 py-3 font-mono text-sm leading-6 whitespace-pre-wrap break-words text-foreground/85">
          {presentation.target}
        </pre>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          className="h-9 min-h-0 rounded-full px-3.5 text-sm"
          type="button"
          variant="outline"
          onPress={() => onResolve(APPROVAL_DECISION.reject)}
        >
          拒绝
          <Kbd className="ml-0.5 h-5 min-w-7 px-1 text-[10px]">Esc</Kbd>
        </Button>

        <Button
          className="h-9 min-h-0 rounded-full bg-foreground px-3.5 text-sm text-background hover:bg-foreground/90"
          type="button"
          onPress={() => onResolve(APPROVAL_DECISION.approveOnce)}
        >
          允许一次
          <Kbd className="ml-0.5 h-5 min-w-6 bg-background/10 px-1 text-[10px] text-background">
            <Kbd.Abbr keyValue="enter" />
          </Kbd>
        </Button>
      </div>
    </section>
  )
}
