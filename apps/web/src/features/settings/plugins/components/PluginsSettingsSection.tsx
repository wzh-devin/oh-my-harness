import { useState } from 'react'
import { Code } from '@gravity-ui/icons'
import { Input, Tabs, TextField } from '@heroui/react'
import type { PluginSettingsTab } from '../../providers/contexts/plugin-settings-context.ts'
import { usePluginSettings } from '../../providers/contexts/plugin-settings-context.ts'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { PluginListPanel } from './PluginListPanel.tsx'

const skillSourceLabels = {
  user: 'oh-my-harness',
  plugin: '插件',
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
          <div className="flex flex-col gap-3">
            <TextField aria-label="搜索技能" value={searchQuery}>
              <Input
                placeholder="搜索技能"
                variant="secondary"
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </TextField>
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
                    actions={
                      <span className="text-xs text-muted">
                        {skill.enabled ? '可用' : '不可用'}
                      </span>
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
        </Tabs.Panel>

        <Tabs.Panel className="pt-5" id="plugins">
          <PluginListPanel
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
