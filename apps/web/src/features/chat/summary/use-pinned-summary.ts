import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

/** 按聊天容器实际宽度决定默认显隐；手动选择由上层保留，避免切换会话时丢失。 */
export const usePinnedSummary = (
  visible: boolean | undefined,
  onVisibleChange: (visible: boolean) => void,
) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [hasRoom, setHasRoom] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setHasRoom(container.clientWidth >= 1080)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const isVisible = visible ?? hasRoom

  /** 仅处理浮层内未被子控件消费的 Esc，关闭后恢复显隐入口的焦点。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    onVisibleChange(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  return {
    containerRef,
    handleKeyDown,
    isVisible,
    reserveSpace: hasRoom && isVisible,
    triggerRef,
  }
}
