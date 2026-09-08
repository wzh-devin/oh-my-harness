import { FILE_SCOPE } from '@oh-my-harness/agent-policy/contracts'
import { isAbsolute } from 'node:path'

/** 只投影执行器确认的真实目标；外部路径保留绝对形式，不能进入工作区预览。 */
export const toolFilePath = (details: unknown): string | undefined => {
  if (!details || typeof details !== 'object' || !('fileTarget' in details))
    return
  const target = details.fileTarget
  if (
    !target ||
    typeof target !== 'object' ||
    !('path' in target) ||
    !('scope' in target)
  )
    return
  const path = target.path
  if (
    typeof path !== 'string' ||
    !path ||
    /[\0\r\n]/u.test(path) ||
    path.split(/[\\/]/u).includes('..')
  )
    return
  if (target.scope === FILE_SCOPE.EXTERNAL && isAbsolute(path)) return path
  if (
    target.scope === FILE_SCOPE.WORKSPACE &&
    !isAbsolute(path) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(path)
  )
    return path
}
