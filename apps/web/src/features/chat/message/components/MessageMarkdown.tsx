import type {
  ComponentProps,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Copy, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { Modal } from '@heroui/react'
import { CodeBlock } from '@agile-avocation/ui-pro/code-block'
import { Markdown, markdownVariants } from '@agile-avocation/ui-pro/markdown'
import {
  FileReferenceIcon,
  getWorkspaceFileReference,
  getWorkspaceImageReference,
  useChatWorkspace,
} from '../../workspace/index.ts'
import { WorkspaceImagePreview } from './WorkspaceImagePreview.tsx'

const markdownSlots = markdownVariants()

const MERMAID_THEME = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
  primaryColor: '#e6efff',
  primaryBorderColor: '#74a7ff',
  primaryTextColor: '#171717',
  lineColor: '#8a8a8a',
  secondaryColor: '#f5f7fb',
  tertiaryColor: '#ffffff',
  mainBkg: '#ffffff',
  actorBkg: '#e6efff',
  actorBorder: '#74a7ff',
  actorTextColor: '#171717',
  signalColor: '#666666',
  signalTextColor: '#333333',
  labelBoxBkgColor: '#ffffff',
  labelBoxBorderColor: '#dedede',
  labelTextColor: '#333333',
  noteBkgColor: '#fff8d6',
  noteBorderColor: '#e0c969',
  noteTextColor: '#333333',
}

interface MermaidDiagramProps {
  code: string
  fallback: ReactNode
}

function MermaidDiagram({ code, fallback }: MermaidDiagramProps) {
  const [result, setResult] = useState<{
    code: string
    error: boolean
    svg?: string
  }>({ code: '', error: false })
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const previewRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    origin: { x: number; y: number }
    pointer: { x: number; y: number }
  } | null>(null)
  const diagramId = `message-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    let cancelled = false

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: MERMAID_THEME,
          flowchart: { useMaxWidth: false },
          sequence: { useMaxWidth: false },
          maxTextSize: 100_000,
          maxEdges: 2_000,
        })
        return mermaid.render(diagramId, code)
      })
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) setResult({ code, error: false, svg: renderedSvg })
      })
      .catch(() => {
        const renderTarget = document.getElementById(diagramId)
        if (renderTarget && !renderTarget.closest('.message-mermaid')) {
          renderTarget.remove()
        }
        if (!cancelled) setResult({ code, error: true })
      })

    return () => {
      cancelled = true
    }
  }, [code, diagramId])

  /** 让展开预览按当前视口完整显示 SVG。 */
  const fitPreview = useCallback(() => {
    const preview = previewRef.current
    const svgElement = preview?.querySelector('svg')
    const viewBox = svgElement?.viewBox.baseVal
    if (!preview || !viewBox?.width || !viewBox.height) return
    const fittedHeight = (preview.clientWidth * viewBox.height) / viewBox.width
    const fittedZoom = Math.min(
      1,
      (preview.clientHeight - 32) / Math.max(fittedHeight, 1),
    )
    setZoom(Math.max(0.1, fittedZoom))
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (!isExpanded || !result.svg) return
    const frame = window.requestAnimationFrame(fitPreview)
    return () => window.cancelAnimationFrame(frame)
  }, [fitPreview, isExpanded, result.svg])

  const changeZoom = useCallback((delta: number) => {
    setZoom((value) => Math.min(4, Math.max(0.1, value + delta)))
  }, [])

  useEffect(() => {
    if (!isExpanded) return
    const preview = previewRef.current
    if (!preview) return
    const handlePreviewWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? 0.1 : -0.1)
    }
    preview.addEventListener('wheel', handlePreviewWheel, { passive: false })
    return () => preview.removeEventListener('wheel', handlePreviewWheel)
  }, [changeZoom, isExpanded])

  if (result.code === code && result.error) return fallback
  if (result.code !== code || !result.svg) {
    return (
      <span aria-busy="true" className="text-sm text-muted">
        正在渲染图表…
      </span>
    )
  }

  const copySource = () => {
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(code).then(() => {
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 1200)
    })
  }

  const resetView = () => {
    if (isExpanded) {
      fitPreview()
      return
    }
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  /** 开始平移预览，并阻止浏览器接管拖拽选文。 */
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      origin: offset,
      pointer: { x: event.clientX, y: event.clientY },
    }
  }

  /** 根据指针位移更新预览位置。 */
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({
      x: drag.origin.x + event.clientX - drag.pointer.x,
      y: drag.origin.y + event.clientY - drag.pointer.y,
    })
  }

  const stopDragging = () => {
    dragRef.current = null
  }

  /** 为预览提供键盘缩放、重置和方向键平移。 */
  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      changeZoom(0.25)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      changeZoom(-0.25)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      resetView()
      return
    }

    const step = event.shiftKey ? 64 : 24
    const moves = {
      ArrowDown: { x: 0, y: -step },
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
    } as const
    const move = moves[event.key as keyof typeof moves]
    if (!move) return
    event.preventDefault()
    setOffset((value) => ({ x: value.x + move.x, y: value.y + move.y }))
  }

  return (
    <>
      <div className="message-mermaid group/message-mermaid">
        <div
          aria-label="Mermaid 图表"
          className="message-mermaid__svg"
          dangerouslySetInnerHTML={{ __html: result.svg }}
          role="img"
        />
        <div className="message-mermaid__actions">
          <button
            aria-label={isCopied ? '已复制 Mermaid 源码' : '复制 Mermaid 源码'}
            className="message-mermaid__button"
            title={isCopied ? '已复制' : '复制源码'}
            type="button"
            onClick={copySource}
          >
            {isCopied ? (
              <Check aria-hidden size={16} />
            ) : (
              <Copy aria-hidden size={16} />
            )}
          </button>
          <button
            aria-label="展开 Mermaid 图表"
            className="message-mermaid__button"
            title="展开图表"
            type="button"
            onClick={() => setIsExpanded(true)}
          >
            <Maximize2 aria-hidden size={16} />
          </button>
        </div>
      </div>
      <Modal.Backdrop
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm"
        isOpen={isExpanded}
        onOpenChange={setIsExpanded}
      >
        <Modal.Container
          className="w-full max-w-[calc(100vw-24px)] p-0 sm:max-w-[1200px]"
          placement="center"
        >
          <Modal.Dialog className="relative max-h-[92vh] w-full max-w-none overflow-auto rounded-2xl bg-background p-4 shadow-2xl outline-none sm:p-6">
            <Modal.CloseTrigger aria-label="关闭 Mermaid 图表" />
            <div className="message-mermaid__preview-controls">
              <button
                aria-label="缩小 Mermaid 图表"
                className="message-mermaid__button"
                title="缩小"
                type="button"
                onClick={() => changeZoom(-0.25)}
              >
                <Minus aria-hidden size={16} />
              </button>
              <button
                aria-label="放大 Mermaid 图表"
                className="message-mermaid__button"
                title="放大"
                type="button"
                onClick={() => changeZoom(0.25)}
              >
                <Plus aria-hidden size={16} />
              </button>
              <button
                aria-label="重置 Mermaid 图表视图"
                className="message-mermaid__button"
                title="重置视图"
                type="button"
                onClick={resetView}
              >
                <RotateCcw aria-hidden size={16} />
              </button>
            </div>
            <div
              aria-label="Mermaid 图表预览，可拖拽平移，方向键也可移动"
              className="message-mermaid__preview"
              ref={previewRef}
              role="img"
              tabIndex={0}
              onKeyDown={handlePreviewKeyDown}
              onPointerCancel={stopDragging}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onDragStart={(event) => event.preventDefault()}
            >
              <div
                className="message-mermaid__preview-stage"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                  width: `${zoom * 100}%`,
                }}
                dangerouslySetInnerHTML={{ __html: result.svg }}
              />
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}

const SAFE_IMAGE_SOURCE = /^(?:https?:\/\/|\/)(?!\/)/iu
const SAFE_DATA_IMAGE_SOURCE = /^data:image\/(?:gif|jpe?g|png|webp);base64,/iu

const isSafeImageSource = (source: string) =>
  SAFE_IMAGE_SOURCE.test(source) || SAFE_DATA_IMAGE_SOURCE.test(source)

const createLocalizedComponents = (workspaceId?: string) =>
  ({
    a: function MessageLink({ node: _node, href, ...props }) {
      const isWebLink = /^(https?:)?\/\//i.test(href ?? '')
      const imageReference =
        workspaceId && href && !href.startsWith('/api/')
          ? getWorkspaceImageReference(href)
          : undefined
      const link = (
        <a
          {...props}
          href={href}
          rel={isWebLink ? 'noopener noreferrer' : undefined}
          target={isWebLink ? '_blank' : undefined}
        />
      )
      if (imageReference && workspaceId) {
        return (
          <WorkspaceImagePreview
            alt={`工作区图片：${imageReference.name}`}
            fallback={link}
            path={imageReference.path}
            workspaceId={workspaceId}
          />
        )
      }
      return link
    },
    img: function MessageImage({ node: _node, src, alt, ...props }) {
      const [failed, setFailed] = useState(false)
      const imageReference =
        workspaceId && src && !src.startsWith('/api/')
          ? getWorkspaceImageReference(src)
          : undefined
      if (imageReference && workspaceId) {
        return (
          <WorkspaceImagePreview
            alt={alt || `工作区图片：${imageReference.name}`}
            fallback={
              <span className="text-sm text-muted">
                图片无法加载：{imageReference.path}
              </span>
            }
            path={imageReference.path}
            workspaceId={workspaceId}
          />
        )
      }
      if (!src || !isSafeImageSource(src) || failed) {
        return (
          <span className="text-sm text-muted">{alt || '图片无法加载'}</span>
        )
      }
      return (
        <img
          {...props}
          alt={alt || '消息图片'}
          className="my-3 max-h-[512px] max-w-full rounded-xl bg-white object-contain p-2"
          decoding="async"
          loading="lazy"
          src={src}
          onError={() => setFailed(true)}
        />
      )
    },
    code: function LocalizedCode({ children, className, node, ...props }) {
      const { onFileOpen, selectedWorkspaceId } = useChatWorkspace()
      const isInline =
        !node?.position?.start.line ||
        node.position.start.line === node.position.end.line

      const imageReference =
        isInline && workspaceId
          ? getWorkspaceImageReference(String(children ?? ''))
          : undefined
      if (imageReference && workspaceId) {
        return (
          <WorkspaceImagePreview
            alt={`工作区图片：${imageReference.name}`}
            fallback={
              <code
                className={`${markdownSlots.inlineCode()} ${className ?? ''}`.trim()}
                {...props}
              >
                {children}
              </code>
            }
            path={imageReference.path}
            workspaceId={workspaceId}
          />
        )
      }

      if (isInline) {
        const fileReference = getWorkspaceFileReference(String(children ?? ''))
        if (fileReference && selectedWorkspaceId && onFileOpen) {
          return (
            <button
              aria-label={`使用本地应用打开 ${fileReference.path}`}
              className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded px-0.5 align-middle font-sans text-sm text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              title={fileReference.path}
              type="button"
              onClick={() => onFileOpen(fileReference.path)}
            >
              <FileReferenceIcon label={fileReference.label} />
              <span className="min-w-0 break-all">{fileReference.name}</span>
            </button>
          )
        }

        return (
          <code
            className={`${markdownSlots.inlineCode()} ${className ?? ''}`.trim()}
            {...props}
          >
            {children}
          </code>
        )
      }

      const code = String(children ?? '').replace(/\n$/, '')
      const language = className?.match(/language-(\w+)/)?.[1] ?? 'plaintext'
      const fallback = (
        <CodeBlock>
          <CodeBlock.Header>
            <span className="text-xs text-muted uppercase">{language}</span>
            <CodeBlock.CopyButton aria-label="复制代码" code={code} />
          </CodeBlock.Header>
          <CodeBlock.Code code={code} language={language} />
        </CodeBlock>
      )

      if (language.toLowerCase() === 'mermaid') {
        return <MermaidDiagram code={code} fallback={fallback} />
      }

      return fallback
    },
  }) satisfies NonNullable<ComponentProps<typeof Markdown>['components']>

interface MessageMarkdownProps {
  children: string
  workspaceId?: string | null
}

/** 渲染消息 Markdown，网页链接在新标签页打开，文件引用沿用本地应用。 */
export function MessageMarkdown({
  children,
  workspaceId,
}: MessageMarkdownProps) {
  const components = useMemo(
    () => createLocalizedComponents(workspaceId ?? undefined),
    [workspaceId],
  )
  return <Markdown components={components}>{children}</Markdown>
}
