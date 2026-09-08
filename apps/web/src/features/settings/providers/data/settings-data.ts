import {
  AGENT_CAPABILITY_SOURCE,
  MCP_SETTINGS_CONNECTION_STATUS,
  MCP_TRANSPORT,
} from '@oh-my-harness/shared'
import type {
  AssistantSkill,
  McpServer,
} from '../contexts/plugin-settings-context.ts'

export const INITIAL_ASSISTANT_SKILLS: readonly AssistantSkill[] = [
  {
    description: '检查当前工作区改动并报告风险。',
    enabled: true,
    id: 'code-review',
    name: '代码审查',
    source: AGENT_CAPABILITY_SOURCE.USER,
  },
  {
    description: '把复杂任务整理为可执行计划。',
    enabled: true,
    id: 'planning',
    name: '计划模式',
    source: AGENT_CAPABILITY_SOURCE.USER,
  },
] as const

export const INITIAL_MCP_SERVERS: readonly McpServer[] = [
  {
    description: '为当前会话提供网页搜索能力。',
    enabled: true,
    endpoint: 'https://mcp.example.com/search',
    id: 'web-search',
    name: '网页搜索',
    scope: AGENT_CAPABILITY_SOURCE.PROJECT,
    status: MCP_SETTINGS_CONNECTION_STATUS.CONNECTED,
    transport: MCP_TRANSPORT.HTTP,
  },
] as const
