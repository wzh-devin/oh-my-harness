import type { ChatTokenUsage } from '../../types/chat-types.ts'

const tokenNumber = new Intl.NumberFormat('en-US')

/** 真实用量保留完整整数，区别于上下文估算的 K/M 缩写。 */
export const formatTokenUsage = (tokens: number) =>
  `${tokenNumber.format(tokens)} tok`

/** 缓存命中率以全部输入（含读取与写入）为分母，保留一位小数。 */
export const tokenUsageDetails = (usage: ChatTokenUsage) => {
  const inputTotal = usage.input + usage.cacheWrite + usage.cacheRead
  return {
    cacheHit:
      inputTotal > 0
        ? `${((usage.cacheRead / inputTotal) * 100).toFixed(1)}%`
        : '—',
    uncachedInput: usage.input,
  }
}
