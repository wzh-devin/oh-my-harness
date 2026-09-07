import { useState } from 'react'
import {
  Button,
  Checkbox,
  Disclosure,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'
import { pluginRequest, type ConnectionVo } from '../api/plugin-api.ts'
import { usePluginConnection } from '../hooks/use-plugin-connection.ts'

/** 管理连接配置与短期 OAuth 状态；凭据只随请求提交，不持久化到浏览器。 */
export function PluginConnection({
  connection,
  onChanged,
}: {
  connection: ConnectionVo
  onChanged(): void
}) {
  const {
    editing,
    setEditing,
    busy,
    error,
    checkedTools,
    setCheckedTools,
    session,
    setSession,
    perform,
  } = usePluginConnection(onChanged)
  const [oauthExpanded, setOauthExpanded] = useState(false)
  return (
    <section
      className="flex min-w-0 flex-col gap-3 border-t border-divider pt-4"
      aria-label={`连接 ${connection.serverName}`}
    >
      <p className="text-sm font-medium text-foreground">
        {connection.serverName} · {connection.transport}
      </p>
      {connection.endpoint ? (
        <p className="break-all text-xs text-muted">{connection.endpoint}</p>
      ) : null}
      <p className="text-xs text-muted">
        {connection.allowed ? '已允许连接' : '需要配置'} · 认证：
        {{
          'not-required': '无需 OAuth',
          disconnected: '未认证',
          authorizing: '认证中',
          authorized: '已认证',
          'reauth-required': '需要重新认证',
        }[connection.authStatus] ?? connection.authStatus}{' '}
        · 网络：
        {{
          disconnected: '未连接',
          connecting: '连接中',
          ready: '就绪',
          error: '连接异常',
        }[connection.connectionStatus] ?? connection.connectionStatus}
      </p>
      {connection.message ? (
        <p className="text-xs text-warning">{connection.message}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
          variant="outline"
          isDisabled={busy || !connection.allowed}
          onPress={() =>
            void perform(async () => {
              const result = await pluginRequest<{ toolCount: number }>(
                `plugin-connections/${encodeURIComponent(connection.id)}/test`,
                { method: 'POST' },
              )
              setCheckedTools(result.toolCount)
            })
          }
        >
          检测连接
        </Button>
        <Button
          size="sm"
          className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
          variant="outline"
          isDisabled={busy}
          onPress={() => setEditing(!editing)}
        >
          配置
        </Button>
        {connection.transport === 'http' ? (
          <Button
            size="sm"
            className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
            variant="outline"
            isDisabled={busy || !connection.allowed}
            onPress={() =>
              void perform(async () =>
                setSession(
                  await pluginRequest('plugin-oauth-sessions', {
                    method: 'POST',
                    body: { connectionId: connection.id },
                  }),
                ),
              )
            }
          >
            OAuth 登录
          </Button>
        ) : null}
        <Button
          size="sm"
          className="h-7 min-h-0 rounded-full !px-2.5 !text-xs text-danger"
          variant="outline"
          isDisabled={busy || !connection.allowed}
          onPress={() =>
            void perform(async () => {
              await pluginRequest(
                `plugin-connections/${encodeURIComponent(connection.id)}`,
                { method: 'DELETE' },
              )
              setSession(null)
            })
          }
        >
          断开并清除凭据
        </Button>
      </div>
      {checkedTools !== null ? (
        <p className="text-xs text-muted" role="status">
          检测成功：发现 {checkedTools} 个工具。聊天选用时将重新建立连接。
        </p>
      ) : null}
      {editing ? (
        <Form
          aria-label={`配置连接 ${connection.serverName}`}
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const values = new FormData(form)
            void perform(async () => {
              const environment = Object.fromEntries(
                connection.requiredKeys.map((key) => [
                  key,
                  String(values.get(`env:${key}`) ?? ''),
                ]),
              )
              await pluginRequest(
                `plugin-connections/${encodeURIComponent(connection.id)}`,
                {
                  method: 'PUT',
                  body: {
                    allowed: values.get('allowed') === 'on',
                    environment,
                    ...Object.fromEntries(
                      [
                        'clientId',
                        'clientSecret',
                        'clientMetadataUrl',
                        'scope',
                      ].flatMap((key) =>
                        values.get(key) ? [[key, String(values.get(key))]] : [],
                      ),
                    ),
                  },
                },
              )
              form.reset()
              setEditing(false)
              setSession(null)
            })
          }}
        >
          <p className="text-xs leading-[18px] text-muted">
            {connection.transport === 'stdio'
              ? '仅信任的插件才能允许启动本地进程：它具有当前系统用户的访问能力，并非沙箱。不会自动安装依赖。'
              : '允许向插件声明的 MCP 服务建立连接。OAuth 范围不替代工具调用审批。'}{' '}
            保存会替换配置并清除旧登录态，敏感字段需重新填写。
          </p>
          <Checkbox name="allowed" value="on" isRequired isDisabled={busy}>
            <Checkbox.Content className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox.Control className="shrink-0 before:bg-foreground">
                <Checkbox.Indicator className="**:data-[slot=checkbox-default-indicator--checkmark]:text-background" />
              </Checkbox.Control>
              我信任此插件并允许连接
            </Checkbox.Content>
            <FieldError />
          </Checkbox>
          {connection.requiredKeys.map((key) => (
            <TextField
              key={key}
              name={`env:${key}`}
              type="password"
              isRequired
              isDisabled={busy}
            >
              <Label>{key}</Label>
              <Input autoComplete="off" variant="secondary" />
              <FieldError />
            </TextField>
          ))}
          {connection.transport === 'http' ? (
            <Disclosure
              isExpanded={oauthExpanded}
              onExpandedChange={setOauthExpanded}
            >
              <Disclosure.Heading className="border-t border-divider pt-4">
                <Button
                  className="h-auto min-h-0 justify-start gap-2 whitespace-normal px-0 py-0 text-left text-sm font-medium text-muted"
                  slot="trigger"
                  type="button"
                  variant="ghost"
                >
                  <Disclosure.Indicator className="shrink-0 text-muted" />
                  OAuth 应用配置（按服务要求填写）
                </Button>
              </Disclosure.Heading>
              <Disclosure.Content className="**:data-[slot=disclosure-body]:p-0">
                <Disclosure.Body className="flex flex-col gap-5 pt-5">
                  {[
                    ['clientId', 'Client ID'],
                    ['clientSecret', 'Client Secret'],
                    ['clientMetadataUrl', 'Client Metadata URL'],
                    ['scope', 'Scope'],
                  ].map(([key, label]) => (
                    <TextField
                      key={key}
                      name={key}
                      type={key === 'clientSecret' ? 'password' : 'text'}
                      isDisabled={busy}
                    >
                      <Label>{label}</Label>
                      <Input autoComplete="off" variant="secondary" />
                    </TextField>
                  ))}
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          ) : null}
          <SettingsEditorActions
            submitLabel={busy ? '保存中…' : '保存连接配置'}
            isDisabled={busy}
            onCancel={() => {
              if (!busy) setEditing(false)
            }}
          />
        </Form>
      ) : null}
      {session ? (
        <div className="space-y-2 text-sm" role="status">
          <p>
            OAuth：
            {session.status === 'failed'
              ? '认证失败，请检查服务是否支持标准 OAuth，或配置 Client ID'
              : ({
                  pending: '等待授权',
                  authorized: '认证成功',
                  cancelled: '已取消',
                  expired: '已过期',
                }[session.status] ?? session.status)}
          </p>
          {session.status === 'pending' && session.authorizationUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="text-accent underline"
                href={session.authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开服务商授权页
              </a>
              <Button
                size="sm"
                className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                variant="outline"
                onPress={() =>
                  void perform(async () => {
                    await pluginRequest(`plugin-oauth-sessions/${session.id}`, {
                      method: 'DELETE',
                    })
                    setSession(null)
                  })
                }
              >
                取消认证
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
