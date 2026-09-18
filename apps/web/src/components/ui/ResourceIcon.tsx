import { useState, type ReactNode } from 'react'

/** 图片失败按当前来源回退；两个主题独立处理，避免坏暗色资源隐藏正常图标。 */
export function ResourceIcon({
  src,
  darkSrc,
  fallback,
  className = 'size-6',
}: {
  src?: string
  darkSrc?: string
  fallback: ReactNode
  className?: string
}) {
  const [failedLight, setFailedLight] = useState('')
  const [failedDark, setFailedDark] = useState('')
  const image = (url: string | undefined, dark: boolean) =>
    url && url !== (dark ? failedDark : failedLight) ? (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-contain"
        onError={() => (dark ? setFailedDark(url) : setFailedLight(url))}
      />
    ) : (
      fallback
    )
  return (
    <span aria-hidden className={`inline-block shrink-0 ${className}`}>
      <span className={`block size-full ${darkSrc ? 'dark:hidden' : ''}`}>
        {image(src, false)}
      </span>
      {darkSrc ? (
        <span className="hidden size-full dark:block">
          {image(darkSrc, true)}
        </span>
      ) : null}
    </span>
  )
}
