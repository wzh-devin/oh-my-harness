import type { Usage } from '@earendil-works/pi-ai'

export interface TokenUsage {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

export const emptyTokenUsage = (): TokenUsage => ({
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
  total: 0,
})

/** 只累加模型实际报告的字段，供会话与运行投影复用。 */
export const addTokenUsage = (total: TokenUsage, usage: Usage): void => {
  total.cacheRead += usage.cacheRead
  total.cacheWrite += usage.cacheWrite
  total.input += usage.input
  total.output += usage.output
  total.total += usage.totalTokens
}
