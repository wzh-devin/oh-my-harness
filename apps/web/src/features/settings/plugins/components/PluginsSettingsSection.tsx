import { useState } from 'react'
import {
  AGENT_CAPABILITY_SOURCE,
  PLUGIN_SETTINGS_TAB,
} from '@oh-my-harness/shared'
import { Code } from '@gravity-ui/icons'
import { Button, Input, Tabs, TextField } from '@heroui/react'
import type { PluginSettingsTab } from '../../providers/contexts/plugin-settings-context.ts'
import { usePluginSettings } from '../../providers/contexts/plugin-settings-context.ts'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { PluginListPanel } from './PluginListPanel.tsx'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import { SkillImportForm } from './SkillImportForm.tsx'
import { SkillDetail } from './SkillDetail.tsx'

const skillSourceLabels = {
  [AGENT_CAPABILITY_SOURCE.USER]: 'oh-my-harness',
  [AGENT_CAPABILITY_SOURCE.PLUGIN]: '插件',
} as const

interface PluginsSettingsSectionProps {
  activeTab: PluginSettingsTab
  onTabChange: (tab: PluginSettingsTab) => void
}

/** 分别展示真实技能、已安装插件和市场来源。 */
export function PluginsSettingsSection({
  activeTab,
  onTabChange,
}: PluginsSettingsSectionProps) {
  const { capabilityError, isLoadingCapabilities, skills } = usePluginSettings()
  const [searchQuery, setSearchQuery] = useState('')
  const [importingSkill, setImportingSkill] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [selectedPluginId, setSelectedPluginId] = useState<string | undefined>()
  const selectedTab = activeTab
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const visibleSkills = skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.source} ${skillSourceLabels[skill.source]}`
      .toLocaleLowerCase()
      .includes(normalizedSearchQuery),
  )

  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="text-base leading-6 font-medium text-foreground">插件</h2>

      <Tabs
        className="mt-4"
        selectedKey={selectedTab}
        variant="secondary"
        onSelectionChange={(key) => {
          setSearchQuery('')
          setImportingSkill(false)
          setImportNotice('')
          setSelectedSkillId(null)
          setSelectedPluginId(undefined)
          onTabChange(String(key) as PluginSettingsTab)
        }}
      >
        <Tabs.ListContainer className="border-b border-divider">
          <Tabs.List aria-label="插件设置" className="!min-w-0">
            <Tabs.Tab className="!w-auto px-3" id="skills">
              技能
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab className="!w-auto px-3" id="plugins">
              插件
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab className="!w-auto px-3" id="marketplaces">
              市场
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel className="pt-5" id="skills">
          {selectedSkillId ? (
            <SkillDetail
              key={selectedSkillId}
              id={selectedSkillId}
              onBack={() => setSelectedSkillId(null)}
              onDeleted={(message) => {
                setSelectedSkillId(null)
                setImportNotice(message)
              }}
              onManagePlugin={(id) => {
                setSelectedPluginId(id)
                setSelectedSkillId(null)
                setSearchQuery('')
                onTabChange(PLUGIN_SETTINGS_TAB.PLUGINS)
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <TextField aria-label="搜索技能" value={searchQuery}>
                <Input
                  placeholder="搜索技能"
                  variant="secondary"
                  onChange={(event) =>
                    setSearchQuery(event.currentTarget.value)
                  }
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
                <p
                  className="py-6 text-center text-sm text-muted"
                  role="status"
                >
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
                      icon={<Code aria-hidden className="size-4 text-muted" />}
                      title={
                        <>
                          <span className="truncate">{skill.name}</span>
                          <span className="shrink-0 text-xs font-normal text-muted">
                            {skillSourceLabels[skill.source]}
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
        </Tabs.Panel>

        <Tabs.Panel className="pt-5" id="plugins">
          <PluginListPanel
            key={selectedPluginId ?? PLUGIN_SETTINGS_TAB.PLUGINS}
            initialSelectedId={selectedPluginId}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        </Tabs.Panel>
        <Tabs.Panel className="pt-5" id="marketplaces">
          <PluginListPanel
            mode="marketplaces"
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        </Tabs.Panel>
      </Tabs>
    </section>
  )
}
