import { LazyLog } from '@melloware/react-logviewer'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLineIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FilterIcon,
  SearchIcon,
} from 'lucide-react'
import '../service-console.css'

/** 日志依赖按控制台打开加载；沿用有界文本，滚动查看历史时暂停跟随。 */
export function ServiceLogViewer({ output }: { output: string }) {
  const [follow, setFollow] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<LazyLog>(null)
  const previousOutputRef = useRef('')

  useEffect(() => {
    // StrictMode 重挂载会重建库的搜索索引；同步重置增量游标和显示行，再灌入当前输出。
    previousOutputRef.current = ''
    viewerRef.current?.clear()
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const previous = previousOutputRef.current
    // 全文 text 更新会重置虚拟列表；完整行增量追加，截断或续写半行才重建。
    const append =
      output.startsWith(previous) && (!previous || previous.endsWith('\n'))
    if (!append) viewer.clear()
    const chunk = append ? output.slice(previous.length) : output
    if (chunk) viewer.appendLines([chunk])
    previousOutputRef.current = output
  }, [output])

  useEffect(() => {
    if (!follow) return
    // 等虚拟行提交后滚到底部；用户暂停时取消待执行的滚动，避免抢回阅读位置。
    const frame = requestAnimationFrame(() => {
      const viewport = containerRef.current?.querySelector('.react-lazylog')
      viewport?.scrollTo({ top: viewport.scrollHeight })
    })
    return () => cancelAnimationFrame(frame)
  }, [follow, output])

  return (
    <div
      className="service-log-viewer"
      ref={containerRef}
      role="region"
      aria-label="服务控制台输出"
      tabIndex={0}
      onWheelCapture={(event) => {
        if (event.deltaY < 0) setFollow(false)
      }}
      onPointerDownCapture={(event) => {
        // 虚拟列表测量也会产生滚动事件，只有用户查看/选择历史内容才暂停。
        if ((event.target as HTMLElement).closest('.react-lazylog'))
          setFollow(false)
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLInputElement) setFollow(false)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        const list = viewerRef.current?.listRef.current
        if (!list) return
        const offsets: Record<string, number> = {
          ArrowUp: -20,
          ArrowDown: 20,
          PageUp: -list.viewportSize,
          PageDown: list.viewportSize,
          Home: -list.scrollSize,
          End: list.scrollSize,
        }
        if (!(event.key in offsets)) return
        event.preventDefault()
        setFollow(false)
        list.scrollBy(offsets[event.key])
      }}
    >
      <SearchIcon
        className="service-log-search-icon"
        aria-hidden="true"
        size={14}
      />
      <button
        className="service-log-follow"
        type="button"
        aria-label="跟随最新输出"
        aria-pressed={follow}
        onClick={() => setFollow((current) => !current)}
      >
        <ArrowDownToLineIcon aria-hidden="true" size={14} />
        {follow ? '正在跟随' : '跟随输出'}
      </button>
      <LazyLog
        ref={viewerRef}
        external
        follow={false}
        enableSearch
        enableHotKeys={false}
        caseInsensitive
        selectableLines
        rowHeight={20}
        extraLines={1}
        iconFilterLines={<FilterIcon aria-hidden="true" size={14} />}
        iconFindNext={<ArrowDownIcon aria-hidden="true" size={14} />}
        iconFindPrevious={<ArrowUpIcon aria-hidden="true" size={14} />}
        internacionalization={{
          searchBar: {
            searchPlaceholder: '搜索日志…',
            matchLabel: '处匹配',
            matchesLabel: '处匹配',
            filterLinesTitle: '只显示匹配行',
            previousButtonTitle: '上一个匹配',
            nextButtonTitle: '下一个匹配',
          },
        }}
      />
    </div>
  )
}
