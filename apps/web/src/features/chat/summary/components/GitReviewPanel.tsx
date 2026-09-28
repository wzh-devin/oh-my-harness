import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button, Tabs, Tooltip } from '@heroui/react'
import { FileTree } from '@agile-avocation/ui-pro/file-tree'
import { Virtualizer } from '@pierre/diffs/react'
import {
  GIT_ACTION,
  GIT_REPOSITORY_STATE,
  type GitAction,
} from '@oh-my-harness/shared'
import {
  ArrowUpIcon,
  Columns2Icon,
  FileDiffIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  PanelTopIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import type { WorkspaceGitController } from '../use-workspace-git.ts'
import {
  buildGitReviewTree,
  getGitFileLabel,
  type GitReviewTreeNode,
} from '../git-review-files.ts'
import { GitActionDialog } from './GitActionDialog.tsx'
import { GitReviewFile } from './GitReviewFile.tsx'
import { FileReferenceIcon } from '../../workspace/index.ts'
import { Collapsible } from '../../../../components/ui/collapsible.tsx'
import '../git-review.css'

interface GitReviewPanelProps {
  workspaceId: string
  workspaceLabel?: string
  git: WorkspaceGitController
  onClose: () => void
}

const getEmptyMessage = (git: WorkspaceGitController) => {
  if (git.isLoading) return '正在读取 Git 状态…'
  if (!git.snapshot) return '未能读取工作区状态。'
  if (git.snapshot.state === GIT_REPOSITORY_STATE.NOT_REPOSITORY)
    return '当前工作区不是 Git 仓库。'
  return '工作区没有变更。'
}

function IconButton({
  label,
  children,
  onPress,
  active,
  disabled,
}: {
  label: string
  children: ReactNode
  onPress: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip delay={300}>
      <Button
        aria-label={label}
        aria-pressed={active}
        isIconOnly
        size="sm"
        variant="ghost"
        className="git-review-icon"
        isDisabled={disabled}
        onPress={onPress}
      >
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

/** 将目录树交给现有 FileTree，保留键盘导航、选中状态与真实 Git 文件徽标。 */
const GitReviewTreeItem = ({
  node,
  onSelect,
}: {
  node: GitReviewTreeNode
  onSelect: (path: string) => void
}): ReactNode => {
  const path = node.file?.path
  const status = node.file ? getGitFileLabel(node.file) : undefined
  return (
    <FileTree.Item
      key={node.id}
      id={node.id}
      onPress={path !== undefined ? () => onSelect(path) : undefined}
      textValue={node.file ? `${node.name}，${status?.label}` : node.name}
      icon={
        node.file ? (
          <FileReferenceIcon
            label={node.file.path.split('.').pop()?.toUpperCase() ?? 'FILE'}
          />
        ) : (
          ({ isExpanded }) => (isExpanded ? <FolderOpenIcon /> : <FolderIcon />)
        )
      }
      title={
        <span
          className="git-review-tree-label"
          title={node.file?.path ?? node.name}
        >
          <span className="truncate">{node.name}</span>
          {status ? (
            <span className={status.tone} aria-hidden>
              {status.badge}
            </span>
          ) : null}
        </span>
      }
    >
      {node.children.map((child) => (
        <GitReviewTreeItem key={child.id} node={child} onSelect={onSelect} />
      ))}
    </FileTree.Item>
  )
}

/** 在受控侧栏的变更标签中组合真实 Git 状态、文件树和 Pierre 只读 Diff。 */
export default function GitReviewPanel({
  workspaceId,
  workspaceLabel,
  git,
  onClose,
}: GitReviewPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLElement>('[role="tab"]')
        ?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [])
  const [selectedPath, setSelectedPath] = useState('')
  const [requestedPaths, setRequestedPaths] = useState<Set<string>>(new Set())
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const scrollHostRef = useRef<HTMLDivElement>(null)
  const fileElements = useRef(new Map<string, HTMLElement>())
  const [treeVisible, setTreeVisible] = useState(true)
  const [split, setSplit] = useState(false)
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [action, setAction] = useState<GitAction | null>(null)
  const snapshot = git.snapshot
  const files = useMemo(() => snapshot?.files ?? [], [snapshot?.files])
  const file = files.find((item) => item.path === selectedPath) ?? files[0]
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const paths: string[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const path = (entry.target as HTMLElement).dataset.gitPath
          if (path !== undefined) paths.push(path)
          observer.unobserve(entry.target)
        }
        if (paths.length)
          setRequestedPaths((previous) => {
            const added = paths.filter((path) => !previous.has(path))
            return added.length ? new Set([...previous, ...added]) : previous
          })
      },
      { root: scrollHostRef.current, rootMargin: '300px 0px' },
    )
    for (const element of fileElements.current.values())
      observer.observe(element)
    return () => observer.disconnect()
  }, [files])
  const tree = useMemo(
    () => buildGitReviewTree(snapshot?.files ?? [], query),
    [snapshot?.files, query],
  )
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    new Set(),
  )
  const treeId = useId()
  const expandedKeys = tree.expandedKeys.filter(
    (key) => query || !collapsedDirectories.has(key),
  )
  const options = useMemo(
    () => ({
      diffStyle: split ? ('split' as const) : ('unified' as const),
      diffIndicators: 'bars' as const,
      theme: { light: 'pierre-light', dark: 'pierre-dark' },
      overflow: 'scroll' as const,
      hunkSeparators: 'simple' as const,
      disableFileHeader: true,
      enableLineSelection: true,
      unsafeCSS:
        ':host { --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-gap-block: 0px; }',
    }),
    [split],
  )

  /** 文件树只定位连续列表，不替换当前内容；未读文件在定位后按需读取。 */
  const selectFile = (path: string) => {
    setSelectedPath(path)
    setRequestedPaths((previous) =>
      previous.has(path) ? previous : new Set([...previous, path]),
    )
    setCollapsedFiles((previous) => {
      if (!previous.has(path)) return previous
      const next = new Set(previous)
      next.delete(path)
      return next
    })
    fileElements.current
      .get(path)
      ?.scrollIntoView({ block: 'start', inline: 'nearest' })
  }
  const refresh = () => {
    setRetry((value) => value + 1)
    void git.refresh()
  }

  return (
    <section className="git-review" aria-label="Git 变更审查" ref={panelRef}>
      <Tabs
        selectedKey={GIT_ACTION.VIEW_CHANGES}
        variant="secondary"
        className="git-review-tabs"
      >
        <Tabs.ListContainer className="git-review-tabbar">
          <Tabs.List aria-label="侧栏功能">
            <Tabs.Tab id={GIT_ACTION.VIEW_CHANGES} className="git-review-tab">
              <FileDiffIcon className="size-4" />
              变更
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <div className="git-review-close">
          <IconButton label="关闭变更侧栏" onPress={onClose}>
            <XIcon />
          </IconButton>
        </div>
        <Tabs.Panel id={GIT_ACTION.VIEW_CHANGES} className="git-review-panel">
          <div className="git-review-toolbar">
            <span className="git-review-workspace" title={workspaceLabel}>
              {workspaceLabel ?? 'Git 工作区'}
            </span>
            {snapshot ? (
              <>
                <span className="git-review-count">{files.length} 个文件</span>
                <span
                  className="git-review-stats"
                  title="跟踪文件的已暂存与未暂存增删合计；未跟踪文件行数在打开文件后显示"
                >
                  <span className="text-success">+{snapshot.additions}</span>
                  <span className="text-danger">−{snapshot.deletions}</span>
                </span>
              </>
            ) : null}
            <div className="git-review-tools">
              <IconButton
                label="刷新变更"
                onPress={refresh}
                disabled={git.isLoading || git.isPending}
              >
                <RefreshCwIcon
                  className={
                    git.isLoading
                      ? 'animate-spin motion-reduce:animate-none'
                      : ''
                  }
                />
              </IconButton>
              <IconButton
                label={split ? '切换为单栏差异' : '切换为双栏差异'}
                active={split}
                onPress={() => setSplit(!split)}
              >
                {split ? <PanelTopIcon /> : <Columns2Icon />}
              </IconButton>
              <Tooltip delay={300}>
                <Button
                  aria-label={treeVisible ? '隐藏文件树' : '显示文件树'}
                  aria-controls={treeId}
                  aria-expanded={treeVisible}
                  className="git-review-icon"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  onPress={() => setTreeVisible(!treeVisible)}
                >
                  <FolderIcon />
                </Button>
                <Tooltip.Content>
                  {treeVisible ? '隐藏文件树' : '显示文件树'}
                </Tooltip.Content>
              </Tooltip>
            </div>
          </div>
          {snapshot ? (
            <div className="git-review-branchbar">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span
                className="truncate"
                title={snapshot.branch ?? snapshot.head ?? ''}
              >
                {snapshot.branch ?? `HEAD ${snapshot.head?.slice(0, 7) ?? ''}`}
              </span>
              <div className="git-review-actions">
                {snapshot.actions.includes(GIT_ACTION.COMMIT) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={git.isPending}
                    onPress={() => setAction(GIT_ACTION.COMMIT)}
                  >
                    <GitCommitHorizontalIcon className="size-3.5" />
                    提交
                  </Button>
                ) : null}
                {snapshot.actions.includes(GIT_ACTION.PUSH) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={git.isPending}
                    onPress={() => setAction(GIT_ACTION.PUSH)}
                  >
                    <ArrowUpIcon className="size-3.5" />
                    推送 {snapshot.ahead}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {git.error ? (
            <div className="git-review-notice" role="alert">
              {git.error}
              <Button
                size="sm"
                variant="ghost"
                isDisabled={git.isPending || git.isLoading}
                onPress={refresh}
              >
                重试
              </Button>
            </div>
          ) : null}
          <div className="git-review-body" data-tree-visible={treeVisible}>
            <div className="git-review-diff" ref={scrollHostRef}>
              {files.length ? (
                <Virtualizer
                  className="git-review-code"
                  contentClassName="git-review-stream"
                >
                  {files.map((item) => (
                    <Collapsible
                      render={<section />}
                      key={item.path}
                      className="git-review-file"
                      open={!collapsedFiles.has(item.path)}
                      onOpenChange={(open) =>
                        setCollapsedFiles((previous) => {
                          const next = new Set(previous)
                          if (open) next.delete(item.path)
                          else next.add(item.path)
                          return next
                        })
                      }
                      aria-label={item.path}
                      data-git-path={item.path}
                      ref={(element) => {
                        if (element)
                          fileElements.current.set(item.path, element)
                        else fileElements.current.delete(item.path)
                      }}
                      onPointerDown={() => setSelectedPath(item.path)}
                      onFocusCapture={() => setSelectedPath(item.path)}
                    >
                      <GitReviewFile
                        workspaceId={workspaceId}
                        file={item}
                        active={requestedPaths.has(item.path)}
                        collapsed={collapsedFiles.has(item.path)}
                        refreshVersion={retry}
                        git={git}
                        options={options}
                      />
                    </Collapsible>
                  ))}
                </Virtualizer>
              ) : (
                <div className="git-review-empty" role="status">
                  {getEmptyMessage(git)}
                </div>
              )}
            </div>
            <aside
              id={treeId}
              aria-label="变更文件"
              className="git-review-files"
              aria-hidden={!treeVisible}
              inert={!treeVisible}
            >
              <label className="git-review-search">
                <SearchIcon aria-hidden className="size-3.5 shrink-0" />
                <input
                  aria-label="筛选变更文件"
                  placeholder="筛选文件…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="git-review-tree-scroll">
                {tree.roots.length ? (
                  <FileTree
                    aria-label="变更文件树"
                    size="sm"
                    selectionMode="single"
                    selectionBehavior="replace"
                    selectedKeys={
                      file ? new Set([`file:${file.path}`]) : new Set()
                    }
                    expandedKeys={expandedKeys}
                    onExpandedChange={(keys) =>
                      setCollapsedDirectories(
                        new Set(
                          tree.expandedKeys.filter((key) => !keys.has(key)),
                        ),
                      )
                    }
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const key = String([...keys][0])
                      if (key.startsWith('file:')) selectFile(key.slice(5))
                    }}
                  >
                    {tree.roots.map((node) => (
                      <GitReviewTreeItem
                        key={node.id}
                        node={node}
                        onSelect={selectFile}
                      />
                    ))}
                  </FileTree>
                ) : (
                  <p className="p-3 text-xs text-muted">
                    {query ? '没有匹配的文件' : '没有变更文件'}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </Tabs.Panel>
      </Tabs>
      {action && snapshot ? (
        <GitActionDialog
          snapshot={snapshot}
          controller={git}
          view={action}
          onClose={() => setAction(null)}
        />
      ) : null}
    </section>
  )
}
