import { useCallback, useEffect, useRef, useState } from 'react'
import { Ellipsis, Pencil, TrashBin } from '@gravity-ui/icons'
import mcpIcon from '@lobehub/icons-static-svg/icons/mcp.svg'
import githubIcon from '@lobehub/icons-static-svg/icons/github.svg'
import {
  Button,
  Dropdown,
  Input,
  Label,
  Switch,
  TextField,
} from '@heroui/react'
import { MCP_CONNECTION_STATUS, MCP_TRANSPORT } from '@oh-my-harness/shared'
import { SettingsItemCard } from '../../shared/components/SettingsItemCard.tsx'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import { SettingsSubpageHeader } from '../../shared/components/SettingsBackNavigation.tsx'
import { mcpApi } from '../api/mcp-api.ts'
import { useMcpSettings } from '../hooks/use-mcp-settings.ts'
import type { McpConfigVo, McpServerVo, McpToolVo } from '../types/mcp-vo.ts'
import { McpJsonEditor } from './McpJsonEditor.tsx'
import { McpServerEditor } from './McpServerEditor.tsx'

const statusLabels = {
  [MCP_CONNECTION_STATUS.DISABLED]: '已停用',
  [MCP_CONNECTION_STATUS.DISCONNECTED]: '未连接',
  [MCP_CONNECTION_STATUS.CONNECTING]: '连接中',
  [MCP_CONNECTION_STATUS.CONNECTED]: '已连接',
  [MCP_CONNECTION_STATUS.ERROR]: '连接失败',
}

/** 管理全局 MCP 服务；列表状态刷新不覆盖已打开编辑器的版本与草稿。 */
export function McpSettingsSection({
  onDirtyChange,
  onBusyChange,
  onOpenPlugin,
}: {
  onOpenPlugin?: (id: string) => void
  onDirtyChange(dirty: boolean): void
  onBusyChange(busy: boolean): void
}) {
  const state = useMcpSettings()
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{
    server?: McpServerVo
    revision: number
  }>()
  const [jsonConfig, setJsonConfig] = useState<McpConfigVo>()
  const [detail, setDetail] = useState<{ id: string; tools: McpToolVo[] }>()
  const [deleteId, setDeleteId] = useState<string>()
  const [notice, setNotice] = useState('')
  const dirty = useRef(false)
  const markDirty = useCallback(
    (value: boolean) => {
      dirty.current = value
      onDirtyChange(value)
    },
    [onDirtyChange],
  )
  useEffect(() => {
    onBusyChange(state.busy)
    return () => onBusyChange(false)
  }, [state.busy, onBusyChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  /** 离开编辑前确认未保存内容，成功保存后的返回不重复询问。 */
  const back = () => {
    if (dirty.current && !window.confirm('放弃尚未保存的 MCP 配置？')) return
    markDirty(false)
    setEditor(undefined)
    setJsonConfig(undefined)
    setDetail(undefined)
    setDeleteId(undefined)
    state.setError('')
  }
  const servers = state.list?.servers ?? []
  const revision = state.list?.revision ?? 0
  const selected = servers.find((server) => server.id === detail?.id)
  const deleting = servers.find((server) => server.id === deleteId)
  const visible = servers.filter((server) =>
    `${server.name} ${server.transport}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )
  /** 读取服务端发现的工具目录后打开详情。 */
  const openDetail = async (server: McpServerVo) => {
    const tools = await state.run((signal) => mcpApi.tools(server.id, signal))
    if (tools) {
      setDetail({ id: server.id, tools })
      setDeleteId(undefined)
    }
  }
  /** 启停请求成功后采用服务端状态，失败时保留原开关值。 */
  const toggle = async (server: McpServerVo, enabled: boolean) => {
    if (!state.list) return
    const list = await state.run((signal) =>
      mcpApi.save(
        server.name,
        { ...server.config, enabled },
        revision,
        signal,
        server.id,
      ),
    )
    if (list) {
      state.setList(list)
      setNotice(
        enabled
          ? '连接成功后供下一轮对话使用。'
          : '已停用；阻止后续调用，已发出的请求可能仍在完成。',
      )
    }
  }

  /** 行内重试与详情重连共用当前服务版本，仍由服务端检查占用。 */
  const reconnect = async (server: McpServerVo) => {
    const list = await state.run((signal) =>
      mcpApi.reconnect(server.id, revision, signal),
    )
    if (list) {
      state.setList(list)
      setNotice('已发起重新连接，已有调用不会重放。')
    }
  }
  /** 确认后删除真实服务配置，保留历史对话。 */
  const remove = async () => {
    if (!deleting) return
    const list = await state.run((signal) =>
      mcpApi.remove(deleting.id, revision, signal),
    )
    if (list) {
      state.setList(list)
      back()
      setNotice('服务已删除，历史对话保留。')
    }
  }
  const edit = (server: McpServerVo) => {
    if (server.owner) {
      onOpenPlugin?.(server.owner.id)
      return
    }
    state.setError('')
    setDetail(undefined)
    setEditor({ server, revision })
  }
  const statusText = (server: McpServerVo) =>
    server.status === MCP_CONNECTION_STATUS.CONNECTED
      ? `已连接 · ${server.toolCount} 个工具`
      : statusLabels[server.status]
  const statusClass = (server: McpServerVo) =>
    server.status === MCP_CONNECTION_STATUS.CONNECTED
      ? 'mt-1 block text-xs text-success'
      : server.status === MCP_CONNECTION_STATUS.ERROR
        ? 'mt-1 block text-xs text-danger'
        : 'mt-1 block text-xs leading-[18px] text-muted'
  const endpoint = (server: McpServerVo) =>
    server.config.url ?? `本地进程 · ${server.config.command}`

  const deleteConfirmation = deleting ? (
    <div
      className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs"
      role="group"
      aria-label="确认删除服务"
    >
      删除「{deleting.name}
      」的服务配置和凭据？历史对话将保留；本机安装的程序不会卸载。
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button
          variant="outline"
          type="button"
          className="h-9 min-h-0 rounded-full px-3.5 text-sm"
          isDisabled={state.busy}
          onPress={() => setDeleteId(undefined)}
        >
          取消
        </Button>
        <Button
          variant="primary"
          type="button"
          className="h-9 min-h-0 rounded-full px-3.5 text-sm bg-foreground text-background hover:bg-foreground/90"
          isDisabled={state.busy}
          onPress={() => {
            void remove()
          }}
        >
          确认删除
        </Button>
      </div>
    </div>
  ) : null

  return (
    <div
      className="mcp-settings mx-auto max-w-2xl text-sm text-foreground"
      data-mcp-view={
        editor ? 'editor' : jsonConfig ? 'json' : detail ? 'detail' : 'list'
      }
    >
      {editor ? (
        <McpServerEditor
          key={editor.server?.id ?? 'new'}
          {...editor}
          state={state}
          onBack={back}
          onDirtyChange={markDirty}
        />
      ) : jsonConfig ? (
        <McpJsonEditor
          config={jsonConfig}
          state={state}
          onBack={back}
          onDirtyChange={markDirty}
        />
      ) : detail ? (
        <section>
          <SettingsSubpageHeader
            label="返回服务列表"
            isDisabled={state.busy}
            onBack={back}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base leading-6 font-medium text-foreground">
                {selected?.name ?? '服务已删除'}
              </h2>
              <Button
                variant="outline"
                type="button"
                className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={state.busy || !selected}
                onPress={() => {
                  if (selected) edit(selected)
                }}
              >
                {selected?.owner ? '管理所属插件' : '编辑配置'}
              </Button>
            </div>
          </SettingsSubpageHeader>
          {selected ? (
            <>
              <p className="text-xs leading-[18px] text-muted mt-1 break-words">
                {endpoint(selected)}
              </p>
              <p className={statusClass(selected)}>{statusText(selected)}</p>
              {selected.status === MCP_CONNECTION_STATUS.ERROR ? (
                <div className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs">
                  {selected.error || '无法连接服务，请检查配置后重试。'}
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      type="button"
                      className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                      isDisabled={
                        state.busy || selected.activeSessionIds.length > 0
                      }
                      onPress={() => {
                        void reconnect(selected)
                      }}
                    >
                      重试连接
                    </Button>
                  </div>
                </div>
              ) : null}
              {selected.activeSessionIds.length ? (
                <p
                  role="status"
                  className="text-xs leading-[18px] text-muted mt-4"
                >
                  正在使用的会话：{selected.activeSessionIds.join('、')}
                </p>
              ) : null}
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">
                    {selected.status === MCP_CONNECTION_STATUS.CONNECTED
                      ? '可用工具'
                      : '上次发现的工具'}
                  </h3>
                  <Button
                    variant="ghost"
                    type="button"
                    className="h-9 min-h-0 rounded-full px-3.5 text-sm text-xs leading-[18px] text-muted"
                    isDisabled={state.busy}
                    onPress={() => {
                      void openDetail(selected)
                    }}
                  >
                    刷新目录
                  </Button>
                </div>
                {detail.tools.length ? (
                  detail.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="border-b border-divider py-3"
                    >
                      <code className="break-words font-mono text-xs">
                        {tool.name}
                      </code>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">
                        {tool.description || '未提供说明'}
                      </p>
                      <details>
                        <summary className="text-xs leading-[18px] text-muted">
                          查看参数
                        </summary>
                        <pre className="font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto text-xs">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))
                ) : (
                  <p className="text-xs leading-[18px] text-muted mt-4">
                    暂无可用工具，连接成功后可刷新目录。
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs">
                调用权限跟随本轮对话：请求批准 /
                帮我批准时逐次询问；完全访问权限下自动调用。
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-6">
                <Button
                  variant="outline"
                  type="button"
                  className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                  isDisabled={
                    state.busy ||
                    !selected.enabled ||
                    selected.activeSessionIds.length > 0
                  }
                  onPress={() => {
                    void reconnect(selected)
                  }}
                >
                  重新连接
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  className="h-9 min-h-0 rounded-full px-3.5 text-sm text-danger"
                  isDisabled={
                    state.busy ||
                    selected.activeSessionIds.length > 0 ||
                    !!selected.owner
                  }
                  onPress={() => setDeleteId(selected.id)}
                >
                  删除服务
                </Button>
              </div>
              {deleteConfirmation}
            </>
          ) : null}
        </section>
      ) : (
        <section className="mx-auto max-w-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base leading-6 font-medium text-foreground">
              MCP
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                type="button"
                className="h-8 min-h-0 rounded-full px-3.5 text-sm"
                isDisabled={state.busy || !state.list}
                onPress={() => {
                  void state
                    .run((signal) => mcpApi.config(signal))
                    .then((config) => {
                      if (config) setJsonConfig(config)
                    })
                }}
              >
                JSON 配置
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-5">
            <TextField
              aria-label="搜索 MCP 服务"
              value={query}
              isDisabled={state.busy}
            >
              <Input
                variant="secondary"
                placeholder="搜索服务"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </TextField>
            <SettingsAddButton
              label="添加服务"
              isDisabled={state.busy || !state.list}
              onPress={() => {
                setNotice('')
                state.setError('')
                setEditor({ revision })
              }}
            />
            {!state.list ? (
              <p className="py-6 text-center text-sm text-muted" role="status">
                正在读取 MCP 配置…
              </p>
            ) : visible.length ? (
              visible.map((server) => (
                <div key={server.id}>
                  <SettingsItemCard
                    openLabel={`查看 MCP 服务 ${server.name}`}
                    isDisabled={state.busy}
                    onOpen={() => {
                      void openDetail(server)
                    }}
                    icon={
                      server.name.toLowerCase() === 'github' ||
                      server.config.url?.startsWith(
                        'https://api.githubcopilot.com/',
                      ) ? (
                        <img
                          src={githubIcon}
                          alt=""
                          aria-hidden
                          className="size-4 shrink-0 dark:invert"
                        />
                      ) : (
                        <img
                          src={mcpIcon}
                          alt=""
                          aria-hidden
                          className="size-4 dark:invert"
                        />
                      )
                    }
                    title={
                      <div className="flex h-5 min-w-0 items-baseline gap-2">
                        <span className="max-w-full shrink-0 truncate">
                          {server.name}
                        </span>
                        <span
                          className={`${statusClass(server)} truncate font-normal`}
                          title={server.error}
                        >
                          {statusText(server)}
                        </span>
                      </div>
                    }
                    description={
                      <span title={endpoint(server)}>
                        {server.transport === MCP_TRANSPORT.HTTP
                          ? '远程 HTTP'
                          : '本地 stdio'}{' '}
                        · {endpoint(server)}
                      </span>
                    }
                    actions={
                      server.owner ? (
                        <Button
                          variant="outline"
                          className="h-7 min-h-0 rounded-full px-2.5 text-xs"
                          isDisabled={state.busy}
                          onPress={() => onOpenPlugin?.(server.owner!.id)}
                        >
                          管理插件
                        </Button>
                      ) : (
                        <>
                          <Switch
                            aria-label={`启用 ${server.name}`}
                            size="sm"
                            isSelected={server.enabled}
                            isDisabled={state.busy}
                            onChange={(enabled) => {
                              void toggle(server, enabled)
                            }}
                          >
                            <Switch.Content>
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                              <Label className="text-xs">启用</Label>
                            </Switch.Content>
                          </Switch>
                          <Dropdown>
                            <Dropdown.Trigger
                              className="size-8 shrink-0"
                              aria-label={`管理 MCP 服务 ${server.name}`}
                              isDisabled={state.busy}
                            >
                              <Ellipsis aria-hidden className="size-4" />
                            </Dropdown.Trigger>
                            <Dropdown.Popover
                              className="min-w-40"
                              placement="bottom end"
                            >
                              <Dropdown.Menu
                                aria-label={`${server.name} 的服务操作`}
                              >
                                <Dropdown.Item
                                  id="edit"
                                  textValue="编辑配置"
                                  isDisabled={
                                    server.activeSessionIds.length > 0
                                  }
                                  onAction={() => edit(server)}
                                >
                                  <Pencil aria-hidden className="size-4" />
                                  编辑配置
                                </Dropdown.Item>
                                <Dropdown.Item
                                  className="text-danger"
                                  id="delete"
                                  textValue="删除服务"
                                  isDisabled={
                                    server.activeSessionIds.length > 0
                                  }
                                  onAction={() => setDeleteId(server.id)}
                                >
                                  <TrashBin aria-hidden className="size-4" />
                                  删除服务
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown>
                        </>
                      )
                    }
                  />
                  {server.status === MCP_CONNECTION_STATUS.ERROR &&
                  server.error ? (
                    <p className="mt-2 break-words text-xs text-danger">
                      {server.error}
                    </p>
                  ) : null}
                  {server.enabled &&
                  server.status === MCP_CONNECTION_STATUS.ERROR ? (
                    <div className="relative mt-2">
                      <Button
                        variant="outline"
                        type="button"
                        className="h-9 min-h-0 rounded-full px-3.5 text-sm"
                        isDisabled={
                          state.busy || server.activeSessionIds.length > 0
                        }
                        onPress={() => {
                          void reconnect(server)
                        }}
                      >
                        重试连接
                      </Button>
                    </div>
                  ) : null}
                  {deleteId === server.id ? (
                    <div className="relative">{deleteConfirmation}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted">
                {query ? '没有匹配的服务' : '尚未添加 MCP 服务'}
              </p>
            )}
            {notice ? (
              <p className="text-xs leading-[18px] text-muted" role="status">
                {notice}
              </p>
            ) : null}
          </div>
        </section>
      )}
      {state.error && !editor && !jsonConfig ? (
        <p className="my-4 break-words text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  )
}
