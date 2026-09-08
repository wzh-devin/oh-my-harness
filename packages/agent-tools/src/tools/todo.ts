import { BUILTIN_TOOL_NAME } from '../tool-names.ts'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { TODO_STATUS, type TodoStatus } from '@oh-my-harness/shared'

export { TODO_STATUS }
const todoStatuses = Object.values(TODO_STATUS)
export type { TodoStatus }

export interface TodoItem {
  content: string
  status: TodoStatus
}

const statuses = new Set<TodoStatus>(todoStatuses)

const parameters = {
  additionalProperties: false,
  properties: {
    todos: {
      items: {
        additionalProperties: false,
        properties: {
          content: { maxLength: 200, minLength: 1, type: 'string' },
          status: {
            enum: todoStatuses,
            type: 'string',
          },
        },
        required: ['content', 'status'],
        type: 'object',
      },
      maxItems: 50,
      type: 'array',
    },
  },
  required: ['todos'],
  type: 'object',
} as unknown as AgentTool['parameters']

/** 校验模型提交的完整 Todo 快照，并返回规范化后的条目。 */
export const parseTodoWriteInput = (input: unknown): TodoItem[] => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Todo input must be an object.')
  }
  const record = input as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'todos')) {
    throw new Error('Todo input contains unsupported fields.')
  }
  if (!Array.isArray(record.todos) || record.todos.length > 50) {
    throw new Error('Todos must be an array with at most 50 items.')
  }

  const seen = new Set<string>()
  let activeCount = 0
  return record.todos.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Each todo must be an object.')
    }
    const item = value as Record<string, unknown>
    if (
      Object.keys(item).length !== 2 ||
      Object.keys(item).some((key) => key !== 'content' && key !== 'status')
    ) {
      throw new Error('Each todo must contain only content and status.')
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content || Array.from(content).length > 200) {
      throw new Error('Todo content must be between 1 and 200 characters.')
    }
    if (seen.has(content)) throw new Error('Todo content must be unique.')
    seen.add(content)
    if (!statuses.has(item.status as TodoStatus)) {
      throw new Error('Todo status is invalid.')
    }
    const status = item.status as TodoStatus
    if (status === TODO_STATUS.IN_PROGRESS && ++activeCount > 1) {
      throw new Error('Only one todo can be in progress.')
    }
    return { content, status }
  })
}

/** 创建以完整快照替换当前计划的模型工具。 */
export const createTodoWriteTool = (
  onUpdated: (todos: readonly TodoItem[]) => Promise<void>,
): AgentTool => ({
  description:
    'Create or replace the complete todo plan for a multi-step task. Keep at most one item in progress, update it as work advances, and pass an empty array to clear it.',
  label: 'update todo plan',
  name: BUILTIN_TOOL_NAME.TODO_WRITE,
  parameters,
  async execute(_toolCallId: string, input: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const todos = parseTodoWriteInput(input)
    await onUpdated(todos)
    const completed = todos.filter(
      (todo) => todo.status === TODO_STATUS.COMPLETED,
    ).length
    const inProgress = todos.filter(
      (todo) => todo.status === TODO_STATUS.IN_PROGRESS,
    ).length
    const pending = todos.length - completed - inProgress
    return {
      content: [
        {
          text: `Todo plan updated: ${completed} completed, ${inProgress} in progress, ${pending} pending.`,
          type: 'text',
        },
      ],
      details: { completed, inProgress, pending, total: todos.length },
    }
  },
})
