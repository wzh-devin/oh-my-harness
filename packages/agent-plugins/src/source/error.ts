/** 可安全映射到 HTTP 的来源输入与文件错误。 */
export class SourceError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'SourceError'
    this.code = code
    this.status = status
  }
}
