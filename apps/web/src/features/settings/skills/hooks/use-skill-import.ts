import {
  SKILL_IMPORT_STATUS,
  SKILL_IMPORT_CANDIDATE_STATUS,
  SKILL_INSTALL_STATUS,
} from '@oh-my-harness/shared'
import { useEffect, useRef, useState } from 'react'
import {
  cancelSkillImport,
  createSkillImport,
  getSkillImport,
  installSkillImport,
  type SkillImportVo,
} from '../api/skill-import-api.ts'

/** 管理一次技能导入的预览、轮询、互斥提交与卸载清理。 */
export const useSkillImport = (
  onInstalled: (name: string, existed: boolean) => void,
  refresh: () => void,
) => {
  const [source, setSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [imported, setImported] = useState<SkillImportVo | null>(null)
  const [candidateKey, setCandidateKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const pending = useRef(false)
  const importId = useRef<string | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      if (importId.current)
        void cancelSkillImport(importId.current).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (imported?.status !== SKILL_IMPORT_STATUS.FETCHING || error) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void getSkillImport(imported.id, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          setImported(result)
          if (result.candidates.length === 1)
            setCandidateKey(result.candidates[0].key)
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setError((cause as Error).message)
        })
    }, 700)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [imported, error])
  const candidate = imported?.candidates.find(
    (value) => value.key === candidateKey,
  )
  const previewing = imported?.status === SKILL_IMPORT_STATUS.FETCHING && !error
  const blocked =
    busy ||
    previewing ||
    (imported?.status === SKILL_IMPORT_STATUS.READY
      ? !candidate ||
        candidate.status === SKILL_IMPORT_CANDIDATE_STATUS.INVALID ||
        candidate.status === SKILL_IMPORT_CANDIDATE_STATUS.CONFLICT
      : !source.trim() && !file)

  /** 出错可重新预览；每次提交前先取消上一次暂存，禁止快速连点。 */
  const submit = async () => {
    if (blocked || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (imported?.status === SKILL_IMPORT_STATUS.READY && candidate) {
        const result = await installSkillImport(imported.id, candidate.key)
        refresh()
        if (active.current)
          onInstalled(
            result.name,
            result.status === SKILL_INSTALL_STATUS.ALREADY_INSTALLED,
          )
      } else {
        if (importId.current) await cancelSkillImport(importId.current)
        const result = await createSkillImport(source, file)
        importId.current = result.id
        if (active.current) {
          setImported(result)
          setCandidateKey('')
        } else await cancelSkillImport(result.id)
      }
    } catch (cause) {
      if (active.current) setError((cause as Error).message)
    } finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }
  return {
    source,
    setSource,
    file,
    setFile,
    imported,
    candidate,
    candidateKey,
    setCandidateKey: (key: string) => {
      setCandidateKey(key)
      setError('')
    },
    busy,
    previewing,
    blocked,
    error,
    submit,
  }
}
