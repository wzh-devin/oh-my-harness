import { useState } from 'react'
import { Button, Modal } from '@heroui/react'
import {
  GIT_ACTION,
  GIT_FILE_STATUS,
  type GitAction,
} from '@oh-my-harness/shared'
import type { WorkspaceGitVo } from '../api/workspace-git-api.ts'
import type { WorkspaceGitController } from '../use-workspace-git.ts'

const viewTitles: Partial<Record<GitAction, string>> = {
  [GIT_ACTION.SWITCH_BRANCH]: '切换分支',
  [GIT_ACTION.COMMIT]: '提交已暂存内容',
  [GIT_ACTION.PUSH]: '推送提交',
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
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25"
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <Modal.Container
        placement="center"
        className="w-full max-w-[calc(100vw-24px)] p-0 sm:max-w-[860px]"
      >
        <Modal.Dialog className="git-dialog w-full max-w-none gap-0 overflow-hidden rounded-2xl bg-surface p-0 shadow-xl outline-none">
          <Modal.Header className="px-5 pt-5 pb-3">
            <Modal.Heading className="text-base font-medium">
              {viewTitles[view]}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="!m-0 !w-full space-y-3 overflow-y-auto px-5 py-0 text-[13px]">
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
              <label className="grid gap-2">
                目标本地分支
                <select
                  className="git-select"
                  value={branch}
                  disabled={pending}
                  onChange={(event) => setSelectedBranch(event.target.value)}
                >
                  {branchOptions.map((item) => (
                    <option key={item.ref} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
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
                <label className="grid gap-2">
                  提交说明
                  <textarea
                    className="git-select min-h-24 resize-y"
                    maxLength={10000}
                    value={message}
                    disabled={pending}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="描述本次修改"
                  />
                </label>
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
          <Modal.Footer className="flex flex-wrap justify-end gap-2 px-5 pt-4 pb-5">
            <Button
              variant="ghost"
              size="sm"
              isDisabled={pending}
              onPress={onClose}
            >
              关闭
            </Button>
            {[
              GIT_ACTION.SWITCH_BRANCH,
              GIT_ACTION.COMMIT,
              GIT_ACTION.PUSH,
            ].some((action) => action === view) ? (
              <Button
                size="sm"
                className="bg-foreground text-background"
                isDisabled={
                  pending ||
                  !snapshot.actions.includes(view) ||
                  (view === GIT_ACTION.COMMIT && !message.trim()) ||
                  (view === GIT_ACTION.SWITCH_BRANCH && !branch)
                }
                onPress={() => void execute(view)}
              >
                {pending
                  ? '正在处理…'
                  : view === GIT_ACTION.SWITCH_BRANCH
                    ? '切换分支'
                    : view === GIT_ACTION.COMMIT
                      ? '确认提交'
                      : '确认推送'}
              </Button>
            ) : null}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
