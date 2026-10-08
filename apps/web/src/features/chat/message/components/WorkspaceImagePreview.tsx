import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { readWorkspaceImage } from '../../workspace/index.ts'

interface WorkspaceImagePreviewProps {
  alt: string
  fallback: ReactNode
  path: string
  workspaceId: string
}

interface ImageState {
  failed: boolean
  src?: string
}

/** 从服务端受控工作区接口加载消息引用的图片，失败时保留原始代码。 */
export function WorkspaceImagePreview({
  alt,
  fallback,
  path,
  workspaceId,
}: WorkspaceImagePreviewProps) {
  const [state, setState] = useState<ImageState>({ failed: false })

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect -- 路径变化时清理上一张图片的加载状态。
    setState({ failed: false })
    void readWorkspaceImage(workspaceId, path, controller.signal)
      .then(({ blob }) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setState({ failed: false, src: objectUrl })
      })
      .catch(() => {
        if (active) setState({ failed: true })
      })

    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, workspaceId])

  if (state.failed) return fallback
  if (!state.src) {
    return (
      <span aria-busy="true" className="text-sm text-muted">
        正在加载图片…
      </span>
    )
  }

  return (
    <figure className="my-3 flex max-w-full flex-col items-start gap-1">
      <img
        alt={alt}
        className="max-h-[512px] max-w-full rounded-xl bg-white object-contain p-2 [image-rendering:auto]"
        decoding="async"
        loading="lazy"
        src={state.src}
        onError={() => setState({ failed: true })}
      />
      <figcaption
        className="max-w-full truncate text-xs text-muted"
        title={path}
      >
        {path}
      </figcaption>
    </figure>
  )
}
