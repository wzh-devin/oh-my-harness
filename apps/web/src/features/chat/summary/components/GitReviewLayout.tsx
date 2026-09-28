import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Resizable } from '@agile-avocation/ui-pro/resizable'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/** 使用稳定的分栏 DOM，避免审查显隐或跨屏幕断点重挂载对话和输入框。 */
export function GitReviewLayout({
  children,
  content,
  open,
  onClose,
}: {
  children: ReactNode
  content: ReactNode
  open: boolean
  onClose: () => void
}) {
  const panelRef = useRef<PanelImperativeHandle>(null)
  const expandedSize = useRef(62)
  const reduceMotion = useReducedMotion()
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (open) panel?.resize(`${expandedSize.current}%`)
    else panel?.collapse()
  }, [open])
  return (
    <Resizable
      className="chat-review-layout"
      data-open={open}
      style={{ height: 'var(--chat-review-height)' }}
    >
      <Resizable.Panel
        id="conversation"
        className="chat-review-main"
        minSize={30}
      >
        {children}
      </Resizable.Panel>
      <Resizable.Handle
        aria-label="调整变更侧栏宽度"
        className="chat-review-handle"
        disabled={!open}
      />
      <Resizable.Panel
        id="git-review"
        className="chat-review-aside"
        handleRef={panelRef}
        defaultSize={62}
        minSize={35}
        maxSize={70}
        collapsible
        collapsedSize={0}
        onResize={({ asPercentage }) => {
          if (open && asPercentage >= 35) expandedSize.current = asPercentage
        }}
        onCollapse={() => {
          if (open) onClose()
        }}
      >
        <div className="h-full min-h-0" aria-hidden={!open} inert={!open}>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                key="review"
                className="h-full min-h-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                {content}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </Resizable.Panel>
    </Resizable>
  )
}
