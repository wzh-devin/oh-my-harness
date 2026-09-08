import { randomUUID } from 'node:crypto'

import type { AuthEvent, AuthPrompt, Models } from '@earendil-works/pi-ai'
import {
  AUTH_METHOD,
  OAUTH_PROMPT_TYPE,
  OAUTH_SESSION_STATUS,
} from '@oh-my-harness/shared'

import type { OAuthPrompt, OAuthSessionStatus } from './oauth-types.ts'

interface PendingPrompt {
  prompt: OAuthPrompt
  reject(error: Error): void
  resolve(value: string): void
}

interface OAuthSession {
  authorizationUrl?: string
  controller: AbortController
  deviceCode?: { userCode: string; verificationUri: string }
  error?: { code: string; message: string }
  expiresAt: number
  pendingPrompt?: PendingPrompt
  progress?: string
  preferredInput?: string
  providerId: string
  sessionId: string
  status: OAuthSessionStatus['status']
  timer: NodeJS.Timeout
}

const terminalStatuses = new Set<OAuthSessionStatus['status']>([
  OAUTH_SESSION_STATUS.SUCCEEDED,
  OAUTH_SESSION_STATUS.FAILED,
  OAUTH_SESSION_STATUS.CANCELLED,
  OAUTH_SESSION_STATUS.EXPIRED,
])

function publicPrompt(prompt: AuthPrompt): OAuthPrompt {
  return {
    message: prompt.message,
    options:
      prompt.type === OAUTH_PROMPT_TYPE.SELECT
        ? prompt.options.map((option) => ({
            label: option.label,
            value: option.id,
          }))
        : undefined,
    promptId: randomUUID(),
    promptType: prompt.type,
  }
}

/** 把 Pi AI 的交互式 OAuth 登录桥接为可轮询的短生命周期会话。 */
export class OAuthSessionService {
  private readonly sessions = new Map<string, OAuthSession>()
  private readonly models: Models
  private readonly ttlMs: number

  constructor(models: Models, ttlMs = 15 * 60 * 1000) {
    this.models = models
    this.ttlMs = ttlMs
  }

  create(providerId: string, preferredInput?: string): OAuthSessionStatus {
    const provider = this.models.getProvider(providerId)
    if (!provider?.auth.oauth) throw new Error('Provider 不支持 OAuth。')

    const controller = new AbortController()
    const sessionId = randomUUID()
    const session: OAuthSession = {
      controller,
      expiresAt: Date.now() + this.ttlMs,
      preferredInput,
      providerId,
      sessionId,
      status: OAUTH_SESSION_STATUS.AWAITING_PROVIDER,
      timer: setTimeout(() => this.expire(sessionId), this.ttlMs),
    }
    session.timer.unref()
    this.sessions.set(sessionId, session)

    void this.models
      .login(providerId, AUTH_METHOD.OAUTH, {
        notify: (event) => this.notify(session, event),
        prompt: (prompt) => this.prompt(session, prompt),
        signal: controller.signal,
      })
      .then(() => {
        if (!terminalStatuses.has(session.status))
          session.status = OAUTH_SESSION_STATUS.SUCCEEDED
        session.pendingPrompt = undefined
      })
      .catch(() => {
        if (
          session.status === OAUTH_SESSION_STATUS.CANCELLED ||
          session.status === OAUTH_SESSION_STATUS.EXPIRED
        )
          return
        session.status = OAUTH_SESSION_STATUS.FAILED
        session.error = {
          code: 'OAUTH_FAILED',
          message: 'OAuth 授权失败，请重试。',
        }
      })

    return this.toStatus(session)
  }

  get(sessionId: string): OAuthSessionStatus | undefined {
    const session = this.sessions.get(sessionId)
    return session && this.toStatus(session)
  }

  input(sessionId: string, promptId: string, value: string) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('OAuth 会话不存在或已过期。')
    if (
      !session.pendingPrompt ||
      session.pendingPrompt.prompt.promptId !== promptId
    ) {
      throw new Error('OAuth 输入已失效。')
    }
    const pending = session.pendingPrompt
    session.pendingPrompt = undefined
    session.status = OAUTH_SESSION_STATUS.AWAITING_PROVIDER
    pending.resolve(value)
    return this.toStatus(session)
  }

  cancel(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.status = OAUTH_SESSION_STATUS.CANCELLED
    session.controller.abort()
    session.pendingPrompt?.reject(new Error('OAuth 授权已取消。'))
    session.pendingPrompt = undefined
  }

  cancelProvider(providerId: string) {
    for (const session of this.sessions.values()) {
      if (
        session.providerId === providerId &&
        !terminalStatuses.has(session.status)
      ) {
        this.cancel(session.sessionId)
      }
    }
  }

  private prompt(
    session: OAuthSession,
    authPrompt: AuthPrompt,
  ): Promise<string> {
    if (
      authPrompt.type === OAUTH_PROMPT_TYPE.SELECT &&
      session.preferredInput &&
      authPrompt.options.some((option) => option.id === session.preferredInput)
    ) {
      const preferredInput = session.preferredInput
      session.preferredInput = undefined
      return Promise.resolve(preferredInput)
    }
    const prompt = publicPrompt(authPrompt)
    session.status = OAUTH_SESSION_STATUS.AWAITING_USER
    return new Promise((resolve, reject) => {
      session.pendingPrompt = { prompt, reject, resolve }
      if (authPrompt.signal?.aborted) {
        session.pendingPrompt = undefined
        reject(new Error('OAuth 输入已取消。'))
        return
      }
      authPrompt.signal?.addEventListener(
        'abort',
        () => {
          if (session.pendingPrompt?.prompt.promptId !== prompt.promptId) return
          session.pendingPrompt = undefined
          if (session.authorizationUrl)
            session.status = OAUTH_SESSION_STATUS.AWAITING_PROVIDER
          reject(new Error('OAuth 输入已取消。'))
        },
        { once: true },
      )
    })
  }

  private notify(session: OAuthSession, event: AuthEvent) {
    if (event.type === 'auth_url') {
      session.authorizationUrl = event.url
      session.status = OAUTH_SESSION_STATUS.AWAITING_PROVIDER
    } else if (event.type === 'device_code') {
      session.deviceCode = {
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      }
      session.status = OAUTH_SESSION_STATUS.AWAITING_PROVIDER
    } else {
      session.progress = event.message
    }
  }

  private expire(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (!terminalStatuses.has(session.status)) {
      session.status = OAUTH_SESSION_STATUS.EXPIRED
      session.controller.abort()
      session.pendingPrompt?.reject(new Error('OAuth 会话已过期。'))
    }
    session.timer = setTimeout(() => this.sessions.delete(sessionId), 60_000)
    session.timer.unref()
  }

  private toStatus(session: OAuthSession): OAuthSessionStatus {
    return {
      authorizationUrl: session.authorizationUrl,
      deviceCode: session.deviceCode,
      error: session.error,
      expiresAt: new Date(session.expiresAt).toISOString(),
      progress: session.progress,
      prompt: session.pendingPrompt?.prompt,
      sessionId: session.sessionId,
      status: session.status,
    }
  }
}
