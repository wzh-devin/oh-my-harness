import { useState } from 'react'
import { ChatConversation } from '@agile-avocation/ui-pro/chat-conversation'
import type { ChatStatus } from '@agile-avocation/ui-pro/prompt-input'
import { Button, Tabs } from '@heroui/react'
import {
  type ApprovalDecision,
  ApprovalPrompt,
  ChatComposer,
  type ChatSubmitPayload,
  type ChatThread,
  type PendingToolApprovalVo,
  ThreadMessage,
} from '../../features/chat/index.ts'
import {
  PERMISSION_OPTIONS,
  type PermissionId,
} from '../../features/settings/index.ts'
import { AgentTraceView } from '../../features/trace/index.ts'
import { TodoPanel } from './TodoPanel.tsx'

interface ChatPageProps {
  activePermission?: PermissionId
  error?: string
  isLoading: boolean
  status: ChatStatus
  thread: ChatThread
  onStop: () => void
  pendingApproval?: PendingToolApprovalVo
  onApprovalResolve: (decision: ApprovalDecision) => Promise<void>
  onModelChange: (
    selection: Pick<ChatSubmitPayload, 'modelId' | 'providerId'>,
  ) => Promise<boolean>
  onRestore: () => Promise<string>
  onSubmit: (payload: ChatSubmitPayload) => boolean
}

/** 保留完整会话工作台，并消费当前 Session 的真实消息与运行状态。 */
export function ChatPage({
  activePermission,
  error,
  isLoading,
  onModelChange,
  onApprovalResolve,
  onStop,
  onSubmit,
  onRestore,
  pendingApproval,
  status,
  thread,
}: ChatPageProps) {
  const [draft, setDraft] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const initialModelKey = thread.providerId
    ? `${thread.providerId}:${thread.modelId}`
    : undefined
  const pendingTool = pendingApproval
    ? {
        approval: {
          ...(pendingApproval.kind === 'command'
            ? {
                description: JSON.stringify(pendingApproval.input, null, 2),
              }
            : {}),
          title: pendingApproval.title,
        },
        input:
          pendingApproval.kind === 'command'
            ? pendingApproval.input
            : { path: pendingApproval.path },
        kind: pendingApproval.kind,
        state: 'requires-action' as const,
        toolCallId: pendingApproval.toolCallId,
        toolName: pendingApproval.toolName,
      }
    : undefined

  return (
    <div className="flex h-[calc(100svh-var(--chat-navbar-height,64px))] flex-col overflow-hidden min-[769px]:h-svh">
      <Tabs
        className="relative flex min-h-0 flex-1 flex-col"
        defaultSelectedKey="conversation"
        variant="secondary"
      >
        <Tabs.ListContainer className="shrink-0 border-b border-divider px-4">
          <Tabs.List aria-label="会话视图" className="!min-w-0">
            <Tabs.Tab className="h-11 !w-auto px-3" id="conversation">
              对话
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab className="h-11 !w-auto px-3" id="trajectory">
              轨迹
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel
          className="min-h-0 flex-1 overflow-hidden p-0"
          id="conversation"
        >
          <ChatConversation className="h-full min-h-0">
            <ChatConversation.Content className="flex flex-col">
              <div className="mx-auto flex w-full max-w-[714px] flex-col gap-8 px-4 pt-10 pb-6">
                {isLoading ? (
                  <p className="text-sm text-muted" role="status">
                    正在加载会话…
                  </p>
                ) : null}
                {!isLoading &&
                !thread.archived &&
                thread.messages.length === 0 &&
                !error ? (
                  <p className="text-sm text-muted">发送消息开始这段会话。</p>
                ) : null}
                {thread.messages.map((message, index) => {
                  const compact = Boolean(
                    message.role === 'assistant' &&
                    !message.activity &&
                    thread.messages[index - 1]?.activity,
                  )
                  return (
                    <div
                      className={compact ? '-mt-8' : undefined}
                      key={message.id}
                    >
                      <ThreadMessage compact={compact} message={message} />
                    </div>
                  )
                })}
              </div>
              <ChatConversation.ScrollAnchor />
            </ChatConversation.Content>
          </ChatConversation>
        </Tabs.Panel>

        <Tabs.Panel
          className="min-h-0 flex-1 overflow-hidden p-0"
          id="trajectory"
        >
          <AgentTraceView />
        </Tabs.Panel>
      </Tabs>

      <div className="shrink-0 bg-background px-4 pt-3 pb-4">
        <div className="mx-auto w-full max-w-[714px]">
          <TodoPanel status={status} todos={thread.todos} />
          {thread.archived ? (
            <div className="border-t border-divider py-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    这是已归档对话
                  </p>
                  <p className="text-xs text-muted">恢复后才能继续发送消息。</p>
                </div>
                <Button
                  isDisabled={isRestoring}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setIsRestoring(true)
                    void onRestore().finally(() => setIsRestoring(false))
                  }}
                >
                  {isRestoring ? '恢复中…' : '恢复对话'}
                </Button>
              </div>
              {error ? (
                <p aria-live="polite" className="mt-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          ) : pendingTool ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
                <span>
                  本轮：
                  {PERMISSION_OPTIONS.find(
                    (option) => option.id === activePermission,
                  )?.label ?? '正在恢复权限…'}
                </span>
                <Button size="sm" variant="ghost" onPress={onStop}>
                  停止本轮
                </Button>
              </div>
              <ApprovalPrompt
                tool={pendingTool}
                onResolve={(decision) => void onApprovalResolve(decision)}
              />
            </div>
          ) : (
            <ChatComposer
              activePermission={activePermission}
              contextUsage={thread.contextUsage}
              error={error}
              fixedWorkspaceId={thread.workspaceId ?? undefined}
              initialModelId={thread.modelId}
              initialModelKey={initialModelKey}
              isDisabled={isLoading || !thread.modelId}
              status={status}
              value={draft}
              onModelChange={onModelChange}
              onStop={onStop}
              onSubmit={onSubmit}
              onValueChange={setDraft}
            />
          )}
        </div>
      </div>
    </div>
  )
}
