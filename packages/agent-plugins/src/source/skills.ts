import type { Skill } from '@earendil-works/pi-agent-core'

/** 独立技能和插件技能共享元数据边界，不改变 Skill 内容。 */
export const validSkill = (skill: Skill) =>
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(skill.name) &&
  !!skill.description.trim() &&
  skill.description.length <= 1024 &&
  skill.content.length <= 200_000
