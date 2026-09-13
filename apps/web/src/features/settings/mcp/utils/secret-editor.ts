export const SAVED_SECRET = '••••••••'

/** 只投影安全元数据，使已有键在写入型 JSON 编辑器中可见。 */
export const secretEditorSource = (keys: readonly string[]) =>
  JSON.stringify(
    Object.fromEntries(keys.map((key) => [key, SAVED_SECRET])),
    null,
    2,
  )

/** 未修改的已保存标记不参与写入；未知键、新值与显式 null 保留给服务端校验。 */
export const secretEditorValues = (
  values: Record<string, unknown>,
  keys: readonly string[],
) =>
  Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      if (value !== SAVED_SECRET) return true
      if (!keys.includes(key))
        throw new Error('新增或重命名的凭据键需要填写实际值。')
      return false
    }),
  )
