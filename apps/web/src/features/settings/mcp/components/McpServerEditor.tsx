import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Disclosure,
  Form,
  Input,
  Label,
  TextArea,
  TextField,
} from '@heroui/react'
import { SelectMenu } from '../../../../components/ui/index.ts'
import { MCP_TRANSPORT, type McpTransport } from '@oh-my-harness/shared'
import { McpJsonInput } from './McpJsonInput.tsx'
import {
  secretEditorSource,
  secretEditorValues,
} from '../utils/secret-editor.ts'
import { mcpApi } from '../api/mcp-api.ts'
import type { useMcpSettings } from '../hooks/use-mcp-settings.ts'
import type { McpListVo, McpServerVo } from '../types/mcp-vo.ts'

/** 展示与 JSON 共用的服务草稿，现有凭据仅显示键名并保持写入模式。 */
export function McpServerEditor({
  server,
  revision,
  state,
  onBack,
  onDirtyChange,
}: {
  server?: McpServerVo
  revision: number
  state: ReturnType<typeof useMcpSettings>
  onBack(): void
  onDirtyChange(dirty: boolean): void
}) {
  const [name, setName] = useState(server?.name ?? '')
  const [transport, setTransport] = useState<McpTransport>(
    server?.transport ?? MCP_TRANSPORT.HTTP,
  )
  const [target, setTarget] = useState(
    server?.config.url ?? server?.config.command ?? '',
  )
  const originalArgs = (server?.config.args ?? []).join('\n')
  const [args, setArgs] = useState(originalArgs)
  const secretKeys =
    (transport === MCP_TRANSPORT.HTTP
      ? server?.secretKeys.headers
      : server?.secretKeys.env) ?? []
  const originalSecrets = secretEditorSource(secretKeys)
  const [secrets, setSecrets] = useState(originalSecrets)
  const [token, setToken] = useState('')
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const readSecret = useCallback(
    (key: string, signal: AbortSignal) =>
      mcpApi.secret(server!.id, key, revision, signal),
    [server, revision],
  )
  const dirty =
    name !== (server?.name ?? '') ||
    transport !== (server?.transport ?? MCP_TRANSPORT.HTTP) ||
    target !== (server?.config.url ?? server?.config.command ?? '') ||
    args !== originalArgs ||
    secrets !== originalSecrets ||
    token !== ''
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  /** 将逐行参数和高级 JSON 转为服务配置，由服务端再次验证字段与凭据规则。 */
  const draft = (enabled: boolean) => {
    let values: unknown
    try {
      values = JSON.parse(secrets)
    } catch {
      throw new Error('高级配置必须是合法 JSON。')
    }
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new Error('凭据必须是 JSON 对象。')
    const secretValues = secretEditorValues(
      values as Record<string, unknown>,
      secretKeys,
    )
    return transport === MCP_TRANSPORT.HTTP
      ? {
          url: target,
          enabled,
          headers: {
            ...secretValues,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        }
      : {
          command: target,
          enabled,
          args:
            args === originalArgs
              ? (server?.config.args ?? [])
              : args
                ? args.split('\n')
                : [],
          env: secretValues,
        }
  }

  /** 连接测试不会保存配置；实际保存后清空含凭据的本地草稿。 */
  const submit = async (
    testing: boolean,
    enabled = server?.enabled ?? false,
  ) => {
    setNotice('')
    setTesting(testing)
    const result = await state.run<McpListVo | { toolCount: number }>(
      (signal) =>
        testing
          ? mcpApi.test(name, draft(enabled), signal, server?.id)
          : mcpApi.save(name, draft(enabled), revision, signal, server?.id),
    )
    setTesting(false)
    if (!result) return
    if ('toolCount' in result)
      setNotice(`连接成功，发现 ${result.toolCount} 个工具。草稿尚未保存。`)
    else {
      state.setList(result)
      onDirtyChange(false)
      onBack()
    }
  }

  return (
    <section>
      <Button
        variant="ghost"
        type="button"
        className="h-9 min-h-0 rounded-full px-3.5 text-sm -ml-3.5 mb-3"
        isDisabled={state.busy}
        onPress={onBack}
      >
        ← 返回服务列表
      </Button>
      <h2 className="text-base leading-6 font-medium text-foreground">
        {server ? '编辑 MCP 服务' : '添加 MCP 服务'}
      </h2>
      <Form
        aria-label={server ? '编辑 MCP 服务' : '添加 MCP 服务'}
        onSubmit={(event) => {
          event.preventDefault()
          void submit(false, true)
        }}
      >
        <TextField
          className="my-4 flex flex-col gap-2"
          isDisabled={state.busy}
          isRequired
        >
          <Label>服务名称</Label>
          <Input
            variant="secondary"
            className="w-full"
            aria-label="服务名称"
            autoFocus
            autoComplete="off"
            placeholder="例如：团队知识库"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </TextField>
        <div className="my-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">连接方式</span>
          <SelectMenu
            ariaLabel="连接方式"
            triggerClassName="w-full"
            isDisabled={state.busy}
            value={transport}
            options={[
              { id: MCP_TRANSPORT.HTTP, label: '远程服务 · Streamable HTTP' },
              { id: MCP_TRANSPORT.STDIO, label: '本地进程 · stdio' },
            ]}
            onChange={(value) => {
              setTransport(value as McpTransport)
              setTarget('')
              setSecrets(
                secretEditorSource(
                  (value === MCP_TRANSPORT.HTTP
                    ? server?.secretKeys.headers
                    : server?.secretKeys.env) ?? [],
                ),
              )
              setToken('')
            }}
          />
        </div>
        <TextField
          className="my-4 flex flex-col gap-2"
          isDisabled={state.busy}
          isRequired
        >
          <Label>
            {transport === MCP_TRANSPORT.HTTP ? '服务地址' : '可执行程序'}
          </Label>
          <Input
            variant="secondary"
            className="w-full"
            aria-label={
              transport === MCP_TRANSPORT.HTTP ? '服务地址' : '可执行程序'
            }
            type={transport === MCP_TRANSPORT.HTTP ? 'url' : 'text'}
            autoComplete="off"
            placeholder={
              transport === MCP_TRANSPORT.HTTP
                ? 'https://example.com/mcp'
                : '例如：npx 或 uvx'
            }
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </TextField>
        {transport === MCP_TRANSPORT.HTTP ? (
          <TextField
            className="my-4 flex flex-col gap-2"
            isDisabled={state.busy}
          >
            <Label>访问令牌（可选）</Label>
            <Input
              variant="secondary"
              className="w-full"
              type="password"
              autoComplete="new-password"
              placeholder="仅写入服务端，保存后不回显"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </TextField>
        ) : (
          <>
            <TextField
              className="my-4 flex flex-col gap-2"
              isDisabled={state.busy}
            >
              <Label>启动参数（每行一个）</Label>
              <TextArea
                variant="secondary"
                className="w-full"
                aria-label="启动参数"
                rows={3}
                placeholder={'--directory\n/path/to/server'}
                spellCheck={false}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
              />
            </TextField>
            <p className="text-xs leading-[18px] text-muted">
              测试连接会以本机用户权限启动该程序。
            </p>
          </>
        )}
        <Disclosure className="my-4">
          <Disclosure.Heading>
            <Disclosure.Trigger
              type="button"
              className="inline-flex items-center gap-2 p-0 text-sm font-normal text-muted hover:text-foreground data-[focus-visible=true]:outline-none data-[focus-visible=true]:ring-0 data-[focus-visible=true]:ring-offset-0 data-[focus-visible=true]:underline underline-offset-4"
            >
              <Disclosure.Indicator />
              高级配置
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content className="**:data-[slot=disclosure-body]:p-0">
            <Disclosure.Body>
              <TextField
                className="my-4 flex flex-col gap-2"
                isDisabled={state.busy}
              >
                <Label>
                  {transport === MCP_TRANSPORT.HTTP ? 'Headers' : '环境变量'}
                  （JSON）
                </Label>
                <McpJsonInput
                  key={transport}
                  label={
                    transport === MCP_TRANSPORT.HTTP ? '请求头' : '环境变量'
                  }
                  compact
                  secretKeys={secretKeys}
                  readSecret={server ? readSecret : undefined}
                  isDisabled={state.busy}
                  value={secrets}
                  onChange={setSecrets}
                />
              </TextField>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
        {notice ? (
          <p className="mt-1 block text-xs text-success" role="status">
            {notice}
          </p>
        ) : null}
        {state.error ? (
          <p className="my-4 break-words text-sm text-danger" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button
            variant="outline"
            type="button"
            className="h-9 min-h-0 rounded-full px-3.5 text-sm"
            isDisabled={state.busy || !name.trim() || !target.trim()}
            onPress={() => {
              void submit(true)
            }}
          >
            测试连接
          </Button>
          <Button
            variant="primary"
            type="submit"
            className="h-9 min-h-0 rounded-full px-3.5 text-sm bg-foreground text-background hover:bg-foreground/90"
            isDisabled={state.busy || !name.trim() || !target.trim()}
          >
            保存并启用
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="h-9 min-h-0 rounded-full px-3.5 text-sm"
            isDisabled={state.busy || !name.trim() || !target.trim()}
            onPress={() => {
              void submit(false, false)
            }}
          >
            仅保存
          </Button>
          {state.busy && testing ? (
            <Button
              variant="ghost"
              type="button"
              className="h-9 min-h-0 rounded-full px-3.5 text-sm"
              onPress={state.cancel}
            >
              取消测试
            </Button>
          ) : null}
        </div>
      </Form>
    </section>
  )
}
