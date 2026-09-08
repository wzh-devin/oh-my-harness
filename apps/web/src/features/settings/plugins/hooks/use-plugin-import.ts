import { useEffect, useRef, useState } from 'react'
import {
  PLUGIN_IMPORT_KIND,
  PLUGIN_IMPORT_STATUS,
  type PluginImportKind,
} from '@oh-my-harness/shared'
import {
  pluginRequest,
  type ImportVo,
  type ImportPreviewVo,
} from '../api/plugin-api.ts'

/** 管理插件导入的获取、预览、取消和提交；服务端保存导入事实。 */
export const usePluginImport = (
  onInstalled: () => void,
  replaceId?: string,
  replaceKind?: PluginImportKind,
) => {
  const [source, setSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [imported, setImported] = useState<ImportVo | null>(null)
  const [candidate, setCandidate] = useState('')
  const [preview, setPreview] = useState<ImportPreviewVo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const importRef = useRef<string | null>(null)
  const active = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      if (importRef.current)
        void pluginRequest(`plugin-imports/${importRef.current}`, {
          method: 'DELETE',
        }).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (imported?.status !== PLUGIN_IMPORT_STATUS.FETCHING) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void pluginRequest<ImportVo>(`plugin-imports/${imported.id}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return
          setImported(result)
          if (result.candidates.length === 1)
            setCandidate(result.candidates[0].key)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setError((error as Error).message)
        })
    }, 700)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [imported])
  useEffect(() => {
    if (
      !imported ||
      imported.status !== PLUGIN_IMPORT_STATUS.READY ||
      !candidate
    )
      return
    const controller = new AbortController()
    void pluginRequest<ImportPreviewVo>(
      `plugin-imports/${imported.id}/preview?${new URLSearchParams({ candidate })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError((error as Error).message)
      })
    return () => controller.abort()
  }, [imported, candidate])
  const submit = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setPreview(null)
    setCandidate('')
    try {
      if (importRef.current)
        await pluginRequest(`plugin-imports/${importRef.current}`, {
          method: 'DELETE',
        })
      const form = new FormData()
      if (file) form.set('file', file)
      const result = await pluginRequest<ImportVo>('plugin-imports', {
        method: 'POST',
        body: file ? form : { url: source.trim() },
      })
      importRef.current = result.id
      if (active.current) setImported(result)
      else
        await pluginRequest(`plugin-imports/${result.id}`, { method: 'DELETE' })
    } catch (error) {
      setError((error as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const cancel = async () => {
    if (!imported) return
    try {
      await pluginRequest(`plugin-imports/${imported.id}`, { method: 'DELETE' })
      importRef.current = null
      setImported(null)
      setPreview(null)
      setCandidate('')
    } catch (error) {
      setError((error as Error).message)
    }
  }
  const install = async () => {
    if (!imported || !preview || pending.current) return
    const chosen = imported.candidates.find((item) => item.key === candidate)!
    if (replaceId && chosen.kind !== replaceKind) {
      setError('替换入口类型不匹配')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await pluginRequest(
        chosen.kind === PLUGIN_IMPORT_KIND.MARKETPLACE
          ? 'plugin-marketplaces'
          : 'plugin-installations',
        {
          method: 'POST',
          body: {
            importId: imported.id,
            candidate,
            ...(replaceId ? { replaceId } : {}),
          },
        },
      )
      await cancel()
      if (active.current) onInstalled()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return {
    source,
    setSource,
    file,
    setFile,
    imported,
    candidate,
    setCandidate,
    preview,
    setPreview,
    busy,
    error,
    setError,
    submit,
    cancel,
    install,
  }
}
