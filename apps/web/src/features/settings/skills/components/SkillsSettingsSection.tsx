import { useState } from 'react'
import { Button, Input, TextField } from '@heroui/react'
import { useCapabilitySettings } from '../../providers/contexts/capability-settings-context.ts'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import { SkillIcon } from './SkillIcon.tsx'
import { SkillImportForm } from './SkillImportForm.tsx'
import { SkillDetail } from './SkillDetail.tsx'

/** 展示技能及所属插件图标，保留独立技能导入和详情入口。 */
export function SkillsSettingsSection({
  onOpenPlugin,
}: {
  onOpenPlugin?: (id: string) => void
}) {
  const { capabilityError, isLoadingCapabilities, skills } =
    useCapabilitySettings()
  const [searchQuery, setSearchQuery] = useState('')
  const [importingSkill, setImportingSkill] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const visibleSkills = skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.source} oh-my-harness`
      .toLocaleLowerCase()
      .includes(normalizedSearchQuery),
  )

  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="text-base leading-6 font-medium text-foreground">技能</h2>

      <div className="pt-5">
        {selectedSkillId ? (
          <SkillDetail
            onOpenPlugin={onOpenPlugin}
            key={selectedSkillId}
            id={selectedSkillId}
            onBack={() => setSelectedSkillId(null)}
            onDeleted={(message) => {
              setSelectedSkillId(null)
              setImportNotice(message)
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <TextField aria-label="搜索技能" value={searchQuery}>
              <Input
                placeholder="搜索技能"
                variant="secondary"
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </TextField>
            {importingSkill ? (
              <SkillImportForm
                onClose={() => setImportingSkill(false)}
                onInstalled={(name, existed) => {
                  setImportingSkill(false)
                  setSearchQuery('')
                  setImportNotice(
                    existed
                      ? `${name} 已导入，可在聊天中选择`
                      : `${name} 导入成功，可在聊天中选择`,
                  )
                }}
              />
            ) : (
              <SettingsAddButton
                label="导入技能"
                onPress={() => {
                  setImportNotice('')
                  setImportingSkill(true)
                }}
              />
            )}
            {importNotice ? (
              <p role="status" className="text-sm text-muted">
                {importNotice}
              </p>
            ) : null}
            {capabilityError ? (
              <p className="text-sm text-danger" role="status">
                {capabilityError}
              </p>
            ) : null}
            {isLoadingCapabilities ? (
              <p className="py-6 text-center text-sm text-muted" role="status">
                正在读取 Skills…
              </p>
            ) : null}
            {!isLoadingCapabilities
              ? visibleSkills.map((skill) => (
                  <SettingsItemCard
                    key={skill.id}
                    openLabel={`查看技能 ${skill.name}`}
                    onOpen={() => {
                      setImportingSkill(false)
                      setSelectedSkillId(skill.id)
                    }}
                    actions={
                      <Button
                        className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                        variant="outline"
                        onPress={() => {
                          setImportingSkill(false)
                          setSelectedSkillId(skill.id)
                        }}
                      >
                        详情
                      </Button>
                    }
                    description={skill.description}
                    icon={<SkillIcon skillId={skill.id} />}
                    title={
                      <>
                        <span className="truncate">{skill.name}</span>
                        <span className="shrink-0 text-xs font-normal text-muted">
                          {skill.pluginName ?? 'oh-my-harness'}
                        </span>
                      </>
                    }
                  />
                ))
              : null}
            {!isLoadingCapabilities && visibleSkills.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                没有匹配的技能
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
