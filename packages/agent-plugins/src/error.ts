import type { PluginErrorCode } from '@oh-my-harness/shared'
import { SourceError } from './source/error.ts'

/** 插件边界错误只包含可以向用户展示的原因。 */
export class PluginError extends SourceError {
  constructor(code: PluginErrorCode, message: string, status = 400) {
    super(code, message, status)
    this.name = 'PluginError'
  }
}
