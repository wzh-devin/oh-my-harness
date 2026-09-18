import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { Link2 } from 'lucide-react'
import {
  MCP_AUTH_METHOD,
  MCP_AUTH_SESSION_STATUS,
  MCP_AUTH_STATUS,
  MCP_CONNECTION_STATUS,
  type McpConnectionStatus,
} from '@oh-my-harness/shared'
import { mcpApi } from '../api/mcp-api.ts'
import type { McpAuthSessionVo, McpAuthVo } from '../types/mcp-vo.ts'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'

const buttonClass = 'h-9 min-h-0 rounded-full px-3.5 text-sm'
interface Props {
  server: {
    id: string
    name: string
    auth: McpAuthVo
    status: McpConnectionStatus
    toolCount: number
    error?: string
  }
  onEnable?: () => Promise<void>
  highlighted?: boolean
  icon?: ReactNode
}
/** 插件与独立 MCP 共用连接面板；仅当前服务进入忙碌状态，返回与取消始终可用。 */
export const McpConnectionPanel = ({
  server,
  onEnable,
  highlighted,
  icon,
}: Props) => {
  const [authSnapshot, setAuthSnapshot] = useState<{
    value: McpAuthVo
    source: string
  }>()
  const source = JSON.stringify(server.auth)
  const currentSource = useRef(source)
  const auth =
    authSnapshot?.source === source ? authSnapshot.value : server.auth
  const setAuth = (value: McpAuthVo) => setAuthSnapshot({ value, source })
  const [session, setSession] = useState<McpAuthSessionVo>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [headerJson, setHeaderJson] = useState('')
  const active = useRef<AbortController | null>(null)
  const enableRequested = useRef(false)
  const enable = useRef(onEnable)
  useEffect(() => {
    enable.current = onEnable
    currentSource.current = source
  }, [onEnable, source])
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )

  const sessionId = session?.id
  const sessionStatus = session?.status
  useEffect(() => {
    if (!sessionId || sessionStatus !== MCP_AUTH_SESSION_STATUS.AUTHORIZING)
      return
    const controller = new AbortController()
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void mcpApi
        .authSession(server.id, sessionId, controller.signal)
        .then(async (result) => {
          if (controller.signal.aborted) return
          if (result.status === MCP_AUTH_SESSION_STATUS.AUTHORIZED) {
            const value = await mcpApi.auth(server.id, controller.signal)
            if (controller.signal.aborted) return
            setAuthSnapshot({
              value,
              source: currentSource.current,
            })
            if (enableRequested.current) {
              enableRequested.current = false
              await enable.current?.()
            }
          }
          if (!controller.signal.aborted) setSession(result)
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setError((cause as Error).message)
        })
        .finally(() => {
          pending = false
        })
    }, 1500)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [server.id, sessionId, sessionStatus])

  /** 网络操作结束后读取服务端事实源，表单凭据不写入浏览器存储。 */
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    try {
      await work(controller.signal)
      if (!controller.signal.aborted)
        setAuth(await mcpApi.auth(server.id, controller.signal))
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message)
    } finally {
      if (active.current === controller) active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const start = () =>
    void run(async (signal) => {
      enableRequested.current = !!onEnable
      setSession(await mcpApi.authStart(server.id, signal))
    })
  const cancel = () => {
    active.current?.abort()
    active.current = null
    setBusy(false)
    enableRequested.current = false
    if (session)
      void run(async (signal) => {
        try {
          await mcpApi.authCancel(server.id, session.id, signal)
        } finally {
          setSession(undefined)
        }
      })
  }
  const connected = server.status === MCP_CONNECTION_STATUS.CONNECTED
  const authorized = auth.status === MCP_AUTH_STATUS.AUTHORIZED
  const pending = session?.status === MCP_AUTH_SESSION_STATUS.AUTHORIZING
  const local = auth.method === MCP_AUTH_METHOD.CREDENTIALS
  const url = session?.authorizationUrl ?? session?.verificationUri
  return (
    <section
      aria-label={`${server.name} 连接`}
      className={`rounded-xl border border-divider p-4 space-y-4 ${highlighted ? 'bg-surface-secondary' : ''}`}
    >
      <div className="flex items-start gap-3">
        {icon ?? (
          <Link2
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-muted"
          />
        )}
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium break-words">{server.name}</h3>
          <p role="status" className="text-xs text-muted">
            {connected
              ? `已连接 · ${server.toolCount} 个工具`
              : authorized
                ? '账号已授权'
                : auth.status === MCP_AUTH_STATUS.SETUP_REQUIRED
                  ? '等待管理员配置'
                  : pending
                    ? '等待完成授权'
                    : auth.status === MCP_AUTH_STATUS.RECONNECT_REQUIRED
                      ? '需要重新登录'
                      : local
                        ? '本地服务'
                        : '连接账号后使用'}
            {auth.accountName ? ` · ${auth.accountName}` : ''}
          </p>
        </div>
      </div>
      {auth.error && auth.status !== MCP_AUTH_STATUS.SETUP_REQUIRED ? (
        <p className="text-sm text-muted break-words">{auth.error}</p>
      ) : null}
      {auth.status === MCP_AUTH_STATUS.SETUP_REQUIRED ? (
        <div className="text-xs text-muted space-y-2">
          <p>
            此服务尚未完成连接配置。请联系部署管理员完成配置后，再连接账号。
          </p>
          {auth.setupUrl ? (
            <a
              className="underline"
              href={auth.setupUrl}
              target="_blank"
              rel="noreferrer"
            >
              服务商配置指引 ↗
            </a>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <div className="space-y-3">
          {session.userCode ? (
            <div className="space-y-2">
              <p className="text-sm">在服务商页面输入此授权码：</p>
              <code className="block select-all text-lg tracking-widest">
                {session.userCode}
              </code>
              <Button
                className={buttonClass}
                variant="outline"
                onPress={() => {
                  void navigator.clipboard
                    .writeText(session.userCode!)
                    .catch(() => setError('复制失败，请手动复制授权码。'))
                }}
              >
                复制授权码
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={`${buttonClass} inline-flex items-center border border-divider`}
              >
                打开授权页 ↗
              </a>
            ) : (
              <p className="text-sm text-muted">正在准备授权页面…</p>
            )}
            <Button variant="outline" className={buttonClass} onPress={cancel}>
              取消授权
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {!local &&
          auth.status !== MCP_AUTH_STATUS.SETUP_REQUIRED &&
          !authorized ? (
            <Button className={buttonClass} isDisabled={busy} onPress={start}>
              {busy ? '正在准备…' : onEnable ? '连接并启用' : '连接账号'}
            </Button>
          ) : null}
          {authorized && onEnable ? (
            <Button
              className={buttonClass}
              isDisabled={busy}
              onPress={() =>
                void run(async () => {
                  await onEnable()
                })
              }
            >
              启用插件
            </Button>
          ) : null}
          {authorized ? (
            <Button
              variant="outline"
              className={buttonClass}
              isDisabled={busy}
              onPress={() =>
                void run(async (signal) => {
                  await mcpApi.authDisconnect(server.id, signal)
                  setSession(undefined)
                })
              }
            >
              断开账号
            </Button>
          ) : null}
          {!local || auth.credentialKeys.length > 0 ? (
            <Button
              variant="outline"
              className={buttonClass}
              onPress={() => setManual(!manual)}
            >
              {local ? '配置环境变量' : '使用手动凭据'}
            </Button>
          ) : null}
          {busy ? (
            <Button variant="ghost" className={buttonClass} onPress={cancel}>
              取消
            </Button>
          ) : null}
        </div>
      )}
      {manual ? (
        <form
          className="space-y-4 border-t border-divider pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async (signal) => {
              let headers: unknown = undefined
              if (headerJson.trim()) {
                try {
                  headers = JSON.parse(headerJson)
                } catch {
                  throw new Error('请求头必须是 JSON 对象。')
                }
              }
              await mcpApi.authCredentials(
                server.id,
                local
                  ? { env: values }
                  : { token: values.token, ...(headers ? { headers } : {}) },
                signal,
              )
              setValues({})
              setHeaderJson('')
              setManual(false)
            })
          }}
        >
          {(local ? auth.credentialKeys : ['token']).map((key) => (
            <TextField key={key} className="w-full">
              <Label>{local ? key : '访问令牌'}</Label>
              <Input
                type="password"
                autoComplete="off"
                value={values[key] ?? ''}
                onChange={(event) =>
                  setValues({ ...values, [key]: event.currentTarget.value })
                }
              />
            </TextField>
          ))}
          {!local ? (
            <label className="block space-y-2 text-sm">
              其他请求头（JSON，可选）
              <textarea
                className="block w-full rounded-xl bg-surface-secondary p-3 font-mono text-xs"
                rows={3}
                value={headerJson}
                onChange={(event) => setHeaderJson(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
          <SettingsEditorActions
            onCancel={() => {
              setManual(false)
              setValues({})
              setHeaderJson('')
            }}
            isDisabled={busy}
            submitLabel="保存凭据"
          />
        </form>
      ) : null}
      {error || session?.error || server.error ? (
        <p role="alert" className="text-xs text-danger break-words">
          {error || session?.error || server.error}
        </p>
      ) : null}
    </section>
  )
}
