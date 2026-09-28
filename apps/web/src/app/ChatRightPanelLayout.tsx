import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Resizable } from '@agile-avocation/ui-pro/resizable'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/** 复用稳定分栏 DOM 承载变更审查或工具控制台，显隐不重挂载对话输入。 */
export function ChatRightPanelLayout({
  children,
  content,
  label,
  open,
  onClose,
  onClosed,
}: {
  children: ReactNode
  content: ReactNode
  label: string
  open: boolean
  onClose: () => void
  onClosed: () => void
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
      className="chat-side-panel-layout"
      data-open={open}
      style={{ height: 'var(--chat-side-panel-height)' }}
    >
      <Resizable.Panel
        id="conversation"
        className="chat-side-panel-main"
        minSize={30}
      >
        {children}
      </Resizable.Panel>
      <Resizable.Handle
        aria-label={`调整${label}宽度`}
        className="chat-side-panel-handle"
        disabled={!open}
      />
      <Resizable.Panel
        id="chat-side-panel"
        className="chat-side-panel-aside"
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
          <AnimatePresence
            initial={false}
            onExitComplete={() => {
              if (!open) onClosed()
            }}
          >
            {open ? (
              <motion.div
                key={label}
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
