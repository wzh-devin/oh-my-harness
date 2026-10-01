import { useState } from 'react'
import { Button, Label, Modal, TextArea, TextField } from '@heroui/react'
import {
  GIT_ACTION,
  GIT_FILE_STATUS,
  type GitAction,
} from '@oh-my-harness/shared'
import { SelectMenu } from '../../../../components/ui/index.ts'
import type { WorkspaceGitVo } from '../api/workspace-git-api.ts'
import type { WorkspaceGitController } from '../use-workspace-git.ts'

const viewTitles: Partial<Record<GitAction, string>> = {
  [GIT_ACTION.SWITCH_BRANCH]: '切换分支',
  [GIT_ACTION.COMMIT]: '提交已暂存内容',
  [GIT_ACTION.PUSH]: '推送提交',
}
const confirmLabels: Partial<Record<GitAction, string>> = {
  [GIT_ACTION.SWITCH_BRANCH]: '切换分支',
  [GIT_ACTION.COMMIT]: '确认提交',
  [GIT_ACTION.PUSH]: '确认推送',
}
interface GitActionDialogProps {
  view: GitAction
  snapshot: WorkspaceGitVo
  controller: WorkspaceGitController
  onClose: () => void
}

/** Git 写操作确认；查看变更由侧栏展示，比较分支使用远端链接。 */
export function GitActionDialog({
  view,
  snapshot,
  controller,
  onClose,
}: GitActionDialogProps) {
  const [selectedBranch, setSelectedBranch] = useState('')
  const [message, setMessage] = useState('')
  const branchOptions = snapshot.branches.filter(
    (item) => item.name !== snapshot.branch && item.local,
  )
  const branch =
    branchOptions.find((item) => item.name === selectedBranch)?.name ??
    branchOptions[0]?.name ??
    ''

  /** 使用当前可见快照版本提交操作，成功后才关闭确认弹窗。 */
  const execute = async (action: GitAction) => {
    const succeeded = await controller.perform({
      action,
      revision: snapshot.revision,
      ...(action === GIT_ACTION.SWITCH_BRANCH ? { branch } : {}),
      ...(action === GIT_ACTION.COMMIT ? { message } : {}),
    })
    if (succeeded) onClose()
  }
  const pending = controller.isPending
  return (
    <Modal.Backdrop
      isOpen
      isDismissable={!pending}
      isKeyboardDismissDisabled={pending}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <Modal.Container
        placement="center"
        className="w-full max-w-[calc(100vw-24px)] p-0 sm:max-w-[860px]"
      >
        <Modal.Dialog className="max-h-[calc(100svh-32px)] w-full max-w-none gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-2xl outline-none">
          <Modal.CloseTrigger
            aria-label={`关闭${viewTitles[view] ?? 'Git 操作'}`}
            isDisabled={pending}
            className="bg-transparent text-foreground hover:bg-surface-secondary"
          />
          <Modal.Header className="px-5 pt-5 pb-3 sm:px-6 sm:pt-6">
            <Modal.Heading className="text-lg font-medium text-foreground">
              {viewTitles[view]}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="!m-0 !w-full space-y-4 overflow-y-auto px-5 py-0 text-sm sm:px-6">
            {controller.error ? (
              <div role="alert" className="flex items-center gap-2 text-danger">
                <span>{controller.error}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={pending}
                  onPress={() => void controller.refresh()}
                >
                  刷新状态
                </Button>
              </div>
            ) : null}
            {view === GIT_ACTION.SWITCH_BRANCH ? (
              <div className="flex flex-col gap-2">
                <Label>目标本地分支</Label>
                <SelectMenu
                  ariaLabel="目标本地分支"
                  className="w-full"
                  isDisabled={pending}
                  options={branchOptions.map((item) => ({
                    id: item.name,
                    label: item.name,
                  }))}
                  triggerClassName="w-full bg-surface-secondary"
                  value={branch}
                  onChange={setSelectedBranch}
                />
              </div>
            ) : null}
            {view === GIT_ACTION.SWITCH_BRANCH ? (
              <p className="text-muted">
                当前：{snapshot.branch ?? '分离 HEAD'}
                。仅在工作区干净且没有进行中的 Git 操作时切换。
              </p>
            ) : null}
            {view === GIT_ACTION.COMMIT ? (
              <>
                <p className="text-muted">
                  提交到 {snapshot.branch ?? '分离 HEAD'}
                  ，仅包含以下已暂存文件：
                </p>
                <ul className="max-h-36 overflow-y-auto rounded-lg border border-border px-3 py-2">
                  {snapshot.files
                    .filter(
                      (item) =>
                        item.indexStatus !== GIT_FILE_STATUS.UNMODIFIED &&
                        item.indexStatus !== GIT_FILE_STATUS.UNTRACKED,
                    )
                    .map((item) => (
                      <li
                        className="truncate py-1"
                        title={item.path}
                        key={item.path}
                      >
                        {item.path}
                      </li>
                    ))}
                </ul>
                <TextField className="flex flex-col gap-2" isDisabled={pending}>
                  <Label>提交说明</Label>
                  <TextArea
                    aria-label="提交说明"
                    className="w-full"
                    maxLength={10000}
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="描述本次修改"
                    variant="secondary"
                  />
                </TextField>
              </>
            ) : null}
            {view === GIT_ACTION.PUSH ? (
              <>
                <p>
                  将 {snapshot.branch} 的 {snapshot.ahead} 个提交推送到{' '}
                  {snapshot.upstream}。
                </p>
                <p className="text-muted">只执行普通推送，不覆盖远端历史。</p>
              </>
            ) : null}
          </Modal.Body>
          <Modal.Footer className="flex flex-wrap justify-end gap-2 px-5 pt-5 pb-5 sm:px-6 sm:pb-6">
            <Button variant="outline" isDisabled={pending} onPress={onClose}>
              关闭
            </Button>
            {[
              GIT_ACTION.SWITCH_BRANCH,
              GIT_ACTION.COMMIT,
              GIT_ACTION.PUSH,
            ].some((action) => action === view) ? (
              <Button
                variant="primary"
                isDisabled={
                  pending ||
                  !snapshot.actions.includes(view) ||
                  (view === GIT_ACTION.COMMIT && !message.trim()) ||
                  (view === GIT_ACTION.SWITCH_BRANCH && !branch)
                }
                onPress={() => void execute(view)}
              >
                {pending ? '正在处理…' : confirmLabels[view]}
              </Button>
            ) : null}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
