import { SquarePlus } from '@gravity-ui/icons'
import { CHAT_ROUTE_KIND } from '@oh-my-harness/shared'
import type { ChatNavItem, ChatSearchMode } from './chat-types.ts'

export const CHAT_NAV_ITEMS: readonly ChatNavItem[] = [
  {
    href: '/new',
    icon: SquarePlus,
    id: CHAT_ROUTE_KIND.NEW,
    label: '新建对话',
  },
] as const

export const CHAT_SEARCH_MODES: readonly ChatSearchMode[] = [
  { id: 'deep-search', label: '深度搜索' },
  { id: 'quick-search', label: '快速搜索' },
] as const

export const SUGGESTED_PROMPTS: readonly string[] = [
  '将本周的产品和设计更新汇总成一份可直接发给团队的进展说明。',
  '把粗略的产品简报转化为包含负责人和截止时间的上线清单。',
  '面向重视投资回报率的审慎管理者，重写这段文字。',
  '为数据密集型分析产品构思新手引导流程名称。',
  '起草一份每周 1:1 议程，突出当前阻碍和成长目标。',
  '比较三种定价模式，并为按量计费的 SaaS 推荐一种。',
] as const
