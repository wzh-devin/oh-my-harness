const compactNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
})

/** 将上下文占用换算为 UI 百分比并限制到完整圆环。 */
export const contextUsagePercent = (
  usedTokens: number,
  contextWindow: number,
) => Math.min(100, (usedTokens / contextWindow) * 100)

/** 未知占用显示占位百分比，避免与零占用或真实低占用混淆。 */
export const formatContextUsagePercent = (percent: number | undefined) => {
  if (percent === undefined) return '—%'
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

/** 使用稳定的 K/M 单位展示近似 token 数。 */
export const formatContextTokens = (tokens: number) =>
  compactNumber.format(tokens)
