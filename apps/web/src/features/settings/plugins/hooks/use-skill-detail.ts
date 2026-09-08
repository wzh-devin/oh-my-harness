import { useEffect, useRef, useState } from 'react'
import {
  deleteSkill,
  getSkillDetail,
  type SkillDetailVo,
} from '../api/skill-import-api.ts'
import { usePluginSettings } from '../../providers/contexts/plugin-settings-context.ts'

/** 读取详情并串行删除，取消旧请求且在成功后刷新聊天共用目录。 */
export const useSkillDetail = (
  id: string,
  onDeleted: (message: string) => void,
) => {
  const { refreshCapabilities } = usePluginSettings()
  const [detail, setDetail] = useState<SkillDetailVo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pending = useRef(false)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    void getSkillDetail(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError((cause as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      active.current = false
      controller.abort()
    }
  }, [id, revision])
  /** 删除必须由确认操作触发；关闭面板不影响已提交的服务端操作。 */
  const remove = async () => {
    if (!detail?.canDelete || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await deleteSkill(id)
      refreshCapabilities()
      if (active.current) onDeleted(result.message)
    } catch (cause) {
      if (active.current) setError((cause as Error).message)
    } finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }
  return {
    detail,
    loading,
    busy,
    error,
    remove,
    retry: () => {
      setLoading(true)
      setError('')
      setRevision((value) => value + 1)
    },
  }
}
