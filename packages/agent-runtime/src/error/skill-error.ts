/** 可安全映射到 HTTP 的独立技能输入与文件错误。 */
export class SkillError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'SkillError'
    this.code = code
    this.status = status
  }
}
