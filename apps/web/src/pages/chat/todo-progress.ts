import type { ChatTodoItem } from '../../features/chat/index.ts'
import { PLAN_STEP_STATE, TODO_STATUS } from '@oh-my-harness/shared'
import type { PlanStep } from '../../types/agent-plan.ts'

export interface TodoProgress {
  completed: number
  current: number
  description: string
  total: number
}

/** 生成计划胶囊显示的完成数和当前任务。 */
export const getTodoProgress = (
  todos: readonly ChatTodoItem[],
): TodoProgress => {
  const completed = todos.filter(
    (todo) => todo.status === TODO_STATUS.COMPLETED,
  ).length
  const currentIndex = todos.findIndex(
    (todo) => todo.status === TODO_STATUS.IN_PROGRESS,
  )
  if (currentIndex >= 0) {
    return {
      completed,
      current: currentIndex + 1,
      description: todos[currentIndex].content,
      total: todos.length,
    }
  }

  const pendingIndex = todos.findIndex(
    (todo) => todo.status === TODO_STATUS.PENDING,
  )
  if (pendingIndex >= 0) {
    return {
      completed,
      current: pendingIndex + 1,
      description: todos[pendingIndex].content,
      total: todos.length,
    }
  }

  return {
    completed,
    current: todos.length,
    description: '计划已完成',
    total: todos.length,
  }
}

const planState = {
  [TODO_STATUS.COMPLETED]: PLAN_STEP_STATE.DONE,
  [TODO_STATUS.IN_PROGRESS]: PLAN_STEP_STATE.ACTIVE,
  [TODO_STATUS.PENDING]: PLAN_STEP_STATE.PENDING,
} as const

/** 将现有 Todo 快照适配为 Scrim UI Agent Plan 步骤。 */
export const toPlanSteps = (
  todos: readonly ChatTodoItem[],
): readonly PlanStep[] =>
  todos.map((todo) => ({
    id: todo.content,
    state: planState[todo.status],
    text: todo.content,
  }))
