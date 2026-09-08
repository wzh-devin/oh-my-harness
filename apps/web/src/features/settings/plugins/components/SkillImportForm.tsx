import {
  SKILL_IMPORT_STATUS,
  SKILL_IMPORT_CANDIDATE_STATUS,
} from '@oh-my-harness/shared'
import { useRef } from 'react'
import { Plus } from '@gravity-ui/icons'
import { Button, Form, Input, Label, TextField } from '@heroui/react'
import { SelectMenu } from '../../../../components/ui/index.ts'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'
import { usePluginSettings } from '../../providers/contexts/plugin-settings-context.ts'
import { useSkillImport } from '../hooks/use-skill-import.ts'

/** 在现有设置编辑器中选择来源、预览候选并导入独立技能。 */
export function SkillImportForm({
  onClose,
  onInstalled,
}: {
  onClose(): void
  onInstalled(name: string, existed: boolean): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const { refreshCapabilities } = usePluginSettings()
  const state = useSkillImport(onInstalled, refreshCapabilities)
  const locked =
    state.busy ||
    state.previewing ||
    state.imported?.status === SKILL_IMPORT_STATUS.READY
  return (
    <SettingsEditorCard>
      <Form
        aria-label="导入技能"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          void state.submit()
        }}
      >
        <div>
          <h3 className="text-sm leading-[22px] font-medium text-foreground">
            导入技能
          </h3>
          <p className="mt-1 text-xs leading-[18px] text-muted">
            识别 SKILL.md
            并保留技能目录内的资源。导入不执行脚本，完成后可在聊天中选择使用。
          </p>
        </div>
        <TextField
          value={state.source}
          isDisabled={locked}
          onChange={(value) => {
            state.setSource(value)
            if (value) state.setFile(null)
          }}
        >
          <Label>GitHub / Git 地址</Label>
          <Input
            autoFocus
            placeholder="owner/repo 或 HTTPS 仓库地址"
            variant="secondary"
          />
        </TextField>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">
            或导入 ZIP 文件
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <input
              ref={input}
              type="file"
              className="hidden"
              accept=".zip"
              onChange={(event) => {
                state.setFile(event.target.files?.[0] ?? null)
                state.setSource('')
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 min-h-0 shrink-0 rounded-full px-3 text-xs"
              isDisabled={locked}
              onPress={() => input.current?.click()}
            >
              <Plus aria-hidden className="size-4" />
              选择 ZIP 文件
            </Button>
            <span
              className="truncate text-xs text-muted"
              title={state.file?.name}
            >
              {state.file?.name ?? '未选择文件'}
            </span>
          </div>
        </div>
        {state.previewing ? (
          <p role="status" className="text-sm text-muted">
            正在获取并检查技能…
          </p>
        ) : null}
        {state.imported?.status === SKILL_IMPORT_STATUS.READY ? (
          <SelectMenu
            ariaLabel="选择技能"
            triggerClassName="w-full"
            value={state.candidateKey}
            isDisabled={state.busy}
            onChange={state.setCandidateKey}
            options={[
              { id: '', label: '请选择技能' },
              ...state.imported.candidates.map((candidate) => ({
                id: candidate.key,
                label: `${candidate.name} · ${candidate.path === '.' ? '根目录' : candidate.path}`,
              })),
            ]}
          />
        ) : null}
        {state.candidate ? (
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-foreground">
              {state.candidate.name}
            </span>
            <p className="break-words text-xs text-muted">
              {state.candidate.description}
            </p>
            {state.candidate.status ===
            SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED ? (
              <p role="status" className="text-xs text-muted">
                已导入，不会重复安装
              </p>
            ) : null}
            {state.candidate.message ? (
              <p role="alert" className="text-xs text-danger">
                {state.candidate.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {state.error || state.imported?.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error || state.imported?.error}
          </p>
        ) : null}
        <SettingsEditorActions
          onCancel={onClose}
          isDisabled={state.blocked}
          submitLabel={
            state.busy || state.previewing
              ? '处理中…'
              : state.imported?.status === SKILL_IMPORT_STATUS.READY
                ? state.candidate?.status ===
                  SKILL_IMPORT_CANDIDATE_STATUS.ALREADY_INSTALLED
                  ? '完成'
                  : '导入技能'
                : '预览导入'
          }
        />
      </Form>
    </SettingsEditorCard>
  )
}
