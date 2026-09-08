import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleFill } from '@gravity-ui/icons'
import {
  API_PROTOCOL,
  AUTH_METHOD,
  OAUTH_PROMPT_TYPE,
  OAUTH_SESSION_STATUS,
  PROVIDER_AUTH_STATUS,
  PROVIDER_CONFIG_STATUS,
} from '@oh-my-harness/shared'
import {
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react'
import { SelectMenu } from '../../../../components/ui/index.ts'
import { useModelSettings } from '../../providers/contexts/model-settings-context.ts'
import { SettingsAddButton } from '../../shared/components/SettingsAddButton.tsx'
import { SettingsEditorActions } from '../../shared/components/SettingsEditorActions.tsx'
import { SettingsEditorCard } from '../../shared/components/SettingsEditorCard.tsx'
import {
  cancelOAuthSession,
  createOAuthSession,
  deleteProvider,
  getOAuthSession,
  saveProviderApiKey,
  saveProviderConfig,
  submitOAuthInput,
} from '../api/index.ts'
import {
  API_PROTOCOL_OPTIONS,
  getOAuthLoginOptions,
  type ApiProtocol,
  type ModelProvider,
  type ProviderConfiguration,
} from '../data/provider-models.ts'
import type {
  AuthMethodVo,
  OAuthSessionStatusVo,
} from '../types/provider-vo.ts'
import { ProviderCustomSettings } from './ProviderCustomSettings.tsx'
import { ProviderDeleteDialog } from './ProviderDeleteDialog.tsx'
import { ProviderEditorHeading } from './ProviderEditorHeading.tsx'
import { ProviderModelCatalog } from './ProviderModelCatalog.tsx'

type ActiveEditor =
  | { type: 'edit'; providerId: string }
  | { type: 'preset' }
  | { type: 'custom' }
  | null

const DEFAULT_API_PROTOCOL: ApiProtocol = API_PROTOCOL.OPENAI_COMPLETIONS
const terminalStatuses = new Set<OAuthSessionStatusVo['status']>([
  OAUTH_SESSION_STATUS.SUCCEEDED,
  OAUTH_SESSION_STATUS.FAILED,
  OAUTH_SESSION_STATUS.CANCELLED,
  OAUTH_SESSION_STATUS.EXPIRED,
])

const createEmptyConfiguration = (
  apiProtocol?: ApiProtocol,
): ProviderConfiguration => ({ apiProtocol, baseUrl: '', models: [] })

const delay = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

/** 保留既有设置布局，管理 Provider 配置与 Pi AI OAuth 授权。 */
export function ModelsSettingsSection() {
  const {
    error: loadError,
    isLoading,
    providers,
    refreshProviders,
    setProviders,
  } = useModelSettings()
  const [activeEditor, setActiveEditor] = useState<ActiveEditor>(null)
  const [presetProviderId, setPresetProviderId] = useState('')
  const [providerConfiguration, setProviderConfiguration] =
    useState<ProviderConfiguration>(createEmptyConfiguration)
  const [authMethod, setAuthMethod] = useState<AuthMethodVo>(
    AUTH_METHOD.API_KEY,
  )
  const [apiKey, setApiKey] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [oauthStatus, setOauthStatus] = useState<OAuthSessionStatusVo | null>(
    null,
  )
  const [oauthInput, setOauthInput] = useState('')
  const [oauthLoginMethod, setOauthLoginMethod] = useState('')
  const [providerToDelete, setProviderToDelete] =
    useState<ModelProvider | null>(null)
  const oauthRun = useRef(0)
  const popup = useRef<Window | null>(null)
  const openedAuthorizationUrl = useRef<string | null>(null)

  const addedProviders = providers.filter(
    (provider) =>
      provider.isCustom ||
      provider.authStatus !== PROVIDER_AUTH_STATUS.UNAUTHORIZED ||
      provider.models.length > 0,
  )
  const availableProviders = providers.filter(
    (provider) =>
      !provider.isCustom &&
      provider.authStatus === PROVIDER_AUTH_STATUS.UNAUTHORIZED &&
      provider.models.length === 0,
  )
  const editingProvider =
    activeEditor?.type === 'edit'
      ? providers.find((provider) => provider.id === activeEditor.providerId)
      : undefined
  const presetProvider =
    activeEditor?.type === 'preset'
      ? providers.find((provider) => provider.id === presetProviderId)
      : undefined
  const authProvider = editingProvider ?? presetProvider
  const isAuthorized =
    authProvider?.authStatus === PROVIDER_AUTH_STATUS.AUTHORIZED
  const oauthLoginOptions = authProvider
    ? getOAuthLoginOptions(authProvider.id)
    : []

  useEffect(
    () => () => {
      oauthRun.current += 1
      popup.current?.close()
    },
    [],
  )

  /** 清理当前 OAuth 交互状态。 */
  const resetOAuth = () => {
    oauthRun.current += 1
    if (oauthStatus && !terminalStatuses.has(oauthStatus.status)) {
      void cancelOAuthSession(oauthStatus.sessionId)
    }
    popup.current?.close()
    popup.current = null
    openedAuthorizationUrl.current = null
    setOauthStatus(null)
    setOauthInput('')
  }

  /** 关闭编辑器并取消尚未完成的 OAuth 会话。 */
  const closeEditor = () => {
    resetOAuth()
    setActiveEditor(null)
    setActionError(null)
  }

  /** 打开已有 Provider 的原编辑表单。 */
  const openEdit = (provider: ModelProvider) => {
    resetOAuth()
    setProviderConfiguration({
      apiProtocol: provider.apiProtocol,
      baseUrl: provider.baseUrl,
      models: provider.models.map((model) => ({ ...model })),
    })
    setAuthMethod(
      provider.configuredAuthMethod ??
        provider.authMethods[0] ??
        AUTH_METHOD.API_KEY,
    )
    setOauthLoginMethod(getOAuthLoginOptions(provider.id)[0]?.id ?? '')
    setApiKey('')
    setActionError(null)
    setActiveEditor({ type: 'edit', providerId: provider.id })
  }

  /** 打开内置 Provider 新增表单。 */
  const openPreset = () => {
    const provider = availableProviders[0]
    if (!provider) return
    resetOAuth()
    setPresetProviderId(provider.id)
    setProviderConfiguration({
      apiProtocol: provider.apiProtocol,
      baseUrl: provider.baseUrl,
      models: [],
    })
    setAuthMethod(provider.authMethods[0] ?? AUTH_METHOD.API_KEY)
    setOauthLoginMethod(getOAuthLoginOptions(provider.id)[0]?.id ?? '')
    setApiKey('')
    setActionError(null)
    setActiveEditor({ type: 'preset' })
  }

  /** 打开原自定义 Provider 表单。 */
  const openCustom = () => {
    resetOAuth()
    setProviderConfiguration(createEmptyConfiguration(DEFAULT_API_PROTOCOL))
    setActionError(null)
    setActiveEditor({ type: 'custom' })
  }

  /** 应用 OAuth 状态并在已创建的窗口中打开授权地址。 */
  const applyOAuthStatus = (status: OAuthSessionStatusVo) => {
    setOauthStatus(status)
    const firstOption = status.prompt?.options?.[0]
    if (firstOption) {
      setOauthInput((current) => current || firstOption.value)
    }
    if (
      status.authorizationUrl &&
      status.authorizationUrl !== openedAuthorizationUrl.current &&
      popup.current
    ) {
      popup.current.location.href = status.authorizationUrl
      openedAuthorizationUrl.current = status.authorizationUrl
    }
  }

  /** 轮询 OAuth 会话，成功后刷新对应 Provider。 */
  const watchOAuth = async (
    initial: OAuthSessionStatusVo,
    providerId: string,
    run: number,
  ) => {
    let status = initial
    while (oauthRun.current === run && !terminalStatuses.has(status.status)) {
      if (status.prompt && !status.authorizationUrl) {
        popup.current?.close()
        popup.current = null
      }
      applyOAuthStatus(status)
      await delay(
        status.prompt || status.authorizationUrl || status.deviceCode
          ? 900
          : 100,
      )
      if (oauthRun.current !== run) return
      status = await getOAuthSession(status.sessionId)
      if (oauthRun.current !== run) return
    }
    if (oauthRun.current !== run) return
    popup.current?.close()
    popup.current = null
    if (status.status === OAUTH_SESSION_STATUS.SUCCEEDED) {
      await refreshProviders()
      setActiveEditor({ type: 'edit', providerId })
      setOauthStatus(null)
      setActionError(null)
    } else {
      setOauthStatus(null)
      setActionError(status.error?.message ?? '授权未完成，请重试')
    }
  }

  /** 使用页面预选的登录方式启动 OAuth；重新授权与保存模型互不替代。 */
  const beginOAuthAuthorization = async () => {
    if (!authProvider || oauthStatus) return
    setActionError(null)
    popup.current?.close()
    popup.current = null
    openedAuthorizationUrl.current = null
    setOauthInput('')
    const selectedLoginMethod =
      oauthLoginMethod || oauthLoginOptions[0]?.id || ''
    if (selectedLoginMethod !== 'device_code') {
      popup.current = window.open(
        '',
        'oh-my-harness-oauth',
        'popup,width=560,height=760',
      )
    }
    const run = ++oauthRun.current
    try {
      const status = await createOAuthSession(
        authProvider.id,
        selectedLoginMethod || undefined,
      )
      void watchOAuth(status, authProvider.id, run).catch((error: unknown) => {
        if (oauthRun.current !== run) return
        popup.current?.close()
        popup.current = null
        setOauthStatus(null)
        setActionError((error as Error).message)
      })
    } catch (error) {
      popup.current?.close()
      popup.current = null
      setOauthStatus(null)
      setActionError((error as Error).message)
    }
  }

  /** 推进授权交互，授权完成后显式保存服务端模型配置。 */
  const handleProviderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authProvider || isSaving) return
    setActionError(null)

    if (authProvider.isCustom) {
      setProviders((current) =>
        current.map((provider) =>
          provider.id === authProvider.id
            ? { ...provider, ...providerConfiguration }
            : provider,
        ),
      )
      closeEditor()
      return
    }

    if (oauthStatus?.prompt) {
      if (!oauthInput) return
      try {
        if (oauthInput === 'device_code') {
          popup.current?.close()
          popup.current = null
        } else if (
          oauthStatus.prompt.promptType === OAUTH_PROMPT_TYPE.SELECT &&
          !popup.current
        ) {
          popup.current = window.open(
            '',
            'oh-my-harness-oauth',
            'popup,width=560,height=760',
          )
        }
        applyOAuthStatus(
          await submitOAuthInput(oauthStatus.sessionId, {
            promptId: oauthStatus.prompt.promptId,
            value: oauthInput,
          }),
        )
        setOauthInput('')
      } catch (error) {
        setActionError((error as Error).message)
      }
      return
    }
    if (oauthStatus) return

    if (authMethod === AUTH_METHOD.OAUTH && !isAuthorized) {
      await beginOAuthAuthorization()
      return
    }

    const nextApiKey = apiKey.trim()
    if (authMethod === AUTH_METHOD.API_KEY && !nextApiKey && !isAuthorized) {
      setActionError('请输入 API 密钥。')
      return
    }

    setIsSaving(true)
    let credentialChanged = false
    try {
      if (authMethod === AUTH_METHOD.API_KEY && nextApiKey) {
        await saveProviderApiKey(authProvider.id, { apiKey: nextApiKey })
        credentialChanged = true
      }
      await saveProviderConfig(authProvider.id, {
        models: providerConfiguration.models,
      })
      await refreshProviders()
      closeEditor()
    } catch (error) {
      if (credentialChanged) await refreshProviders()
      setActionError((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  /** 创建原页面会话级自定义 Provider。 */
  const handleCustomSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const id = String(formData.get('providerId') ?? '').trim()
    const name = String(formData.get('displayName') ?? '').trim()
    const baseUrl = providerConfiguration.baseUrl.trim()
    if (
      !id ||
      !name ||
      !baseUrl ||
      !providerConfiguration.apiProtocol ||
      providers.some((provider) => provider.id === id)
    ) {
      return
    }

    setProviders((current) => [
      ...current,
      {
        ...providerConfiguration,
        authStatus: PROVIDER_AUTH_STATUS.AUTHORIZED,
        authMethods: [AUTH_METHOD.API_KEY],
        baseUrl,
        configStatus: providerConfiguration.models.length
          ? PROVIDER_CONFIG_STATUS.CONFIGURED
          : PROVIDER_CONFIG_STATUS.UNCONFIGURED,
        configuredAuthMethod: AUTH_METHOD.API_KEY,
        id,
        isCustom: true,
        name,
        ready: providerConfiguration.models.length > 0,
      },
    ])
    closeEditor()
  }

  /** 删除自定义 Provider，或删除服务端保存的内置 Provider 状态。 */
  const handleDeleteProvider = async () => {
    if (!providerToDelete) return
    try {
      if (providerToDelete.isCustom) {
        setProviders((current) =>
          current.filter((provider) => provider.id !== providerToDelete.id),
        )
      } else {
        await deleteProvider(providerToDelete.id)
        await refreshProviders()
      }
      if (
        activeEditor?.type === 'edit' &&
        activeEditor.providerId === providerToDelete.id
      ) {
        closeEditor()
      }
      setProviderToDelete(null)
    } catch (error) {
      setActionError((error as Error).message)
    }
  }

  const authenticationFields = authProvider ? (
    <>
      {authProvider.authMethods.length > 1 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">认证方式</span>
          <SelectMenu
            ariaLabel="认证方式"
            options={authProvider.authMethods.map((method) => ({
              id: method,
              label: method === AUTH_METHOD.OAUTH ? 'OAuth2 授权' : 'API Key',
            }))}
            triggerClassName="w-full sm:max-w-60"
            value={authMethod}
            onChange={(method) => {
              resetOAuth()
              setAuthMethod(method as AuthMethodVo)
              setOauthLoginMethod(oauthLoginOptions[0]?.id ?? '')
              setActionError(null)
            }}
          />
        </div>
      ) : null}

      {authMethod === AUTH_METHOD.API_KEY ? (
        <TextField name="apiKey" type="password">
          <Label>API 密钥</Label>
          <Input
            autoComplete="new-password"
            placeholder={
              isAuthorized ? '已配置——输入新值可替换' : '输入 API 密钥'
            }
            value={apiKey}
            variant="secondary"
            onChange={(event) => setApiKey(event.target.value)}
          />
          {isAuthorized ? (
            <Description>密钥不会在页面中回显。</Description>
          ) : null}
        </TextField>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {oauthLoginOptions.length > 1 && !oauthStatus ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                授权方式
              </span>
              <SelectMenu
                ariaLabel="授权方式"
                options={oauthLoginOptions}
                triggerClassName="w-full sm:max-w-72"
                value={oauthLoginMethod}
                onChange={setOauthLoginMethod}
              />
            </div>
          ) : null}
          {isAuthorized && !oauthStatus ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">已授权</span>
              <Button
                className="h-8 min-h-0 rounded-full px-3 text-xs"
                type="button"
                variant="outline"
                onPress={() => void beginOAuthAuthorization()}
              >
                重新授权
              </Button>
            </div>
          ) : null}
          {oauthStatus?.authorizationUrl ? (
            <a
              className="text-accent underline underline-offset-4"
              href={oauthStatus.authorizationUrl}
              rel="noreferrer"
              target="_blank"
            >
              打开授权页面
            </a>
          ) : null}
          {oauthStatus?.deviceCode ? (
            <div className="rounded-xl bg-surface-secondary p-3">
              <p>设备码：{oauthStatus.deviceCode.userCode}</p>
              <a
                className="text-accent underline underline-offset-4"
                href={oauthStatus.deviceCode.verificationUri}
                rel="noreferrer"
                target="_blank"
              >
                打开设备授权页面
              </a>
            </div>
          ) : null}
          {oauthStatus?.prompt ? (
            oauthStatus.prompt.options?.length ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">
                  {oauthStatus.prompt.message}
                </span>
                <SelectMenu
                  ariaLabel={oauthStatus.prompt.message}
                  options={oauthStatus.prompt.options.map((option) => ({
                    id: option.value,
                    label: option.label,
                  }))}
                  triggerClassName="w-full sm:max-w-72"
                  value={oauthInput}
                  onChange={setOauthInput}
                />
              </div>
            ) : (
              <TextField
                type={
                  oauthStatus.prompt.promptType === OAUTH_PROMPT_TYPE.SECRET
                    ? 'password'
                    : 'text'
                }
              >
                <Label>{oauthStatus.prompt.message}</Label>
                <Input
                  value={oauthInput}
                  variant="secondary"
                  onChange={(event) => setOauthInput(event.target.value)}
                />
              </TextField>
            )
          ) : null}
        </div>
      )}
    </>
  ) : null

  const submitLabel =
    authMethod === AUTH_METHOD.OAUTH && !isAuthorized
      ? oauthStatus?.prompt
        ? '继续'
        : oauthStatus
          ? '授权中…'
          : '授权'
      : isSaving
        ? '保存中…'
        : '保存'

  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="text-base leading-6 font-medium text-foreground">模型</h2>

      <div className="mt-5 flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-muted">正在读取提供方…</p>
        ) : null}
        {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}

        {addedProviders.map((provider) => (
          <Card
            key={provider.id}
            className="flex h-[54px] min-h-0 flex-row items-center justify-between gap-4 rounded-xl !border !border-solid !border-foreground/15 bg-surface px-3.5 py-3 shadow-none"
            variant="transparent"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {provider.name}
              </span>
              <CircleFill
                aria-label={`${provider.name} ${provider.ready ? '可用' : '待配置模型'}`}
                className={`size-2 shrink-0 ${provider.ready ? 'text-success' : 'text-muted'}`}
                role="img"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                className="h-7 min-h-0 rounded-full !px-2.5 !text-xs"
                size="sm"
                variant="outline"
                onPress={() => openEdit(provider)}
              >
                编辑
              </Button>
              <Button
                aria-label={`删除 ${provider.name}`}
                className="h-7 min-h-0 rounded-full !px-2.5 !text-xs text-danger"
                size="sm"
                variant="outline"
                onPress={() => setProviderToDelete(provider)}
              >
                删除
              </Button>
            </div>
          </Card>
        ))}

        {activeEditor === null ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <SettingsAddButton label="添加提供方" onPress={openPreset} />
            <SettingsAddButton label="添加自定义提供方" onPress={openCustom} />
          </div>
        ) : null}

        {editingProvider ? (
          <SettingsEditorCard>
            <Form
              aria-label={`编辑 ${editingProvider.name}`}
              className="flex flex-col gap-5"
              onSubmit={handleProviderSubmit}
            >
              <ProviderEditorHeading
                description={editingProvider.id}
                isInline
                title={editingProvider.name}
              />
              {authenticationFields}
              <ProviderCustomSettings
                key={editingProvider.id}
                providerId={editingProvider.id}
                value={providerConfiguration}
                onChange={setProviderConfiguration}
              />
              {actionError ? (
                <p className="text-sm text-danger">{actionError}</p>
              ) : null}
              <SettingsEditorActions
                submitLabel={submitLabel}
                onCancel={closeEditor}
              />
            </Form>
          </SettingsEditorCard>
        ) : null}

        {activeEditor?.type === 'preset' && presetProvider ? (
          <SettingsEditorCard>
            <Form
              aria-label="添加提供方"
              className="flex flex-col gap-5"
              onSubmit={handleProviderSubmit}
            >
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">
                  提供方
                </span>
                <SelectMenu
                  ariaLabel="提供方"
                  options={availableProviders.map((provider) => ({
                    id: provider.id,
                    label: provider.id,
                  }))}
                  triggerClassName="w-full sm:max-w-60"
                  value={presetProviderId}
                  onChange={(providerId) => {
                    const provider = availableProviders.find(
                      (item) => item.id === providerId,
                    )
                    if (!provider) return
                    resetOAuth()
                    setPresetProviderId(providerId)
                    setProviderConfiguration({
                      apiProtocol: provider.apiProtocol,
                      baseUrl: provider.baseUrl,
                      models: [],
                    })
                    setAuthMethod(
                      provider.authMethods[0] ?? AUTH_METHOD.API_KEY,
                    )
                    setOauthLoginMethod(
                      getOAuthLoginOptions(provider.id)[0]?.id ?? '',
                    )
                    setApiKey('')
                    setActionError(null)
                  }}
                />
              </div>
              {authenticationFields}
              <ProviderCustomSettings
                key={presetProviderId}
                providerId={presetProviderId}
                value={providerConfiguration}
                onChange={setProviderConfiguration}
              />
              {actionError ? (
                <p className="text-sm text-danger">{actionError}</p>
              ) : null}
              <SettingsEditorActions
                submitLabel={submitLabel}
                onCancel={closeEditor}
              />
            </Form>
          </SettingsEditorCard>
        ) : null}

        {activeEditor?.type === 'custom' ? (
          <SettingsEditorCard>
            <Form
              aria-label="添加自定义提供方"
              className="flex flex-col gap-5"
              onSubmit={handleCustomSubmit}
            >
              <ProviderEditorHeading title="自定义提供方" />
              <TextField
                isRequired
                name="providerId"
                pattern="[a-z][a-z0-9-]*"
                validate={(value) =>
                  providers.some((provider) => provider.id === value.trim())
                    ? 'Provider ID 已存在'
                    : null
                }
              >
                <Label>Provider ID</Label>
                <Input placeholder="acme-gateway" variant="secondary" />
                <Description>
                  以小写字母开头的标识，在请求中唯一标识该提供方，并用于派生凭据名。
                </Description>
                <FieldError />
              </TextField>
              <TextField isRequired name="displayName">
                <Label>显示名称</Label>
                <Input placeholder="显示名称" variant="secondary" />
                <FieldError />
              </TextField>
              <TextField isRequired name="baseUrl" type="url">
                <Label>API 地址</Label>
                <Input
                  placeholder="https://gateway.example/v1"
                  value={providerConfiguration.baseUrl}
                  variant="secondary"
                  onChange={(event) =>
                    setProviderConfiguration({
                      ...providerConfiguration,
                      baseUrl: event.target.value,
                    })
                  }
                />
                <FieldError />
              </TextField>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">
                  API 协议
                </span>
                <SelectMenu
                  ariaLabel="API 协议"
                  options={API_PROTOCOL_OPTIONS}
                  triggerClassName="w-full sm:max-w-60"
                  value={
                    providerConfiguration.apiProtocol ?? DEFAULT_API_PROTOCOL
                  }
                  onChange={(apiProtocol) =>
                    setProviderConfiguration({
                      ...providerConfiguration,
                      apiProtocol: apiProtocol as ApiProtocol,
                    })
                  }
                />
              </div>
              <TextField isRequired name="apiKey" type="password">
                <Label>API 密钥</Label>
                <Input
                  autoComplete="new-password"
                  placeholder="输入 API 密钥"
                  variant="secondary"
                />
                <FieldError />
              </TextField>
              <ProviderModelCatalog
                canLoadAvailableModels={false}
                providerId=""
                value={providerConfiguration.models}
                onChange={(models) =>
                  setProviderConfiguration({
                    ...providerConfiguration,
                    models,
                  })
                }
              />
              <SettingsEditorActions
                submitLabel="创建提供方"
                onCancel={closeEditor}
              />
            </Form>
          </SettingsEditorCard>
        ) : null}
      </div>

      {providerToDelete ? (
        <ProviderDeleteDialog
          provider={providerToDelete}
          onClose={() => setProviderToDelete(null)}
          onConfirm={() => void handleDeleteProvider()}
        />
      ) : null}
    </section>
  )
}
