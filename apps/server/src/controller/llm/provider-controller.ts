import {
  ModelServiceError,
  type ModelService,
  type OAuthSessionService,
} from '@oh-my-harness/llm'
import type { Context } from 'hono'

import type {
  ApiKeyCredentialRequestDto,
  ProviderConfigUpdateDto,
  ProviderInfoDto,
  ProviderModelInfoDto,
} from '../../dto/llm/provider-dto.ts'

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function isProviderConfig(value: unknown): value is ProviderConfigUpdateDto {
  if (!value || typeof value !== 'object') return false
  const models = (value as { models?: unknown }).models
  return (
    Array.isArray(models) &&
    models.length <= 500 &&
    models.every(
      (model) =>
        !!model &&
        typeof model === 'object' &&
        typeof (model as { id?: unknown }).id === 'string' &&
        (model as { id: string }).id.length <= 512 &&
        ((model as { maxOutputTokens?: unknown }).maxOutputTokens ===
          undefined ||
          isPositiveSafeInteger(
            (model as { maxOutputTokens?: unknown }).maxOutputTokens,
          )) &&
        ((model as { name?: unknown }).name === undefined ||
          (typeof (model as { name?: unknown }).name === 'string' &&
            (model as { name: string }).name.length <= 512)),
    )
  )
}

function modelServiceError(error: unknown) {
  return error instanceof ModelServiceError
    ? { code: error.code, message: error.message, status: error.status }
    : {
        code: 'PROVIDER_CONFIG_FAILED',
        message: 'Provider 配置操作失败。',
        status: 500 as const,
      }
}

/** 创建 Provider HTTP Controller，并保持核心包不感知 Hono。 */
export function createProviderController(
  models: ModelService,
  oauth: OAuthSessionService,
) {
  return {
    deleteCredential: async (context: Context) => {
      const providerId = context.req.param('id')!
      try {
        oauth.cancelProvider(providerId)
        await models.deleteCredential(providerId)
        return context.body(null, 204)
      } catch {
        return context.json(
          { code: 'CREDENTIAL_DELETE_FAILED', message: '凭证删除失败。' },
          400,
        )
      }
    },
    deleteProvider: async (context: Context) => {
      const providerId = context.req.param('id')!
      try {
        oauth.cancelProvider(providerId)
        await models.deleteProvider(providerId)
        return context.body(null, 204)
      } catch (error) {
        const response = modelServiceError(error)
        return context.json(
          { code: response.code, message: response.message },
          response.status,
        )
      }
    },
    getModels: (context: Context) => {
      const catalog = models.getProviderModels(context.req.param('id')!)
      return catalog
        ? context.json(catalog satisfies ProviderModelInfoDto[])
        : context.json(
            { code: 'PROVIDER_NOT_FOUND', message: 'Provider 不存在。' },
            404,
          )
    },
    list: async (context: Context) => {
      const providers = await models.listProviders()
      return context.json(providers satisfies ProviderInfoDto[])
    },
    saveApiKey: async (context: Context) => {
      const body = await context.req
        .json<ApiKeyCredentialRequestDto>()
        .catch(() => undefined)
      const apiKey = body?.apiKey?.trim()
      if (!apiKey || apiKey.length > 16_384) {
        return context.json(
          { code: 'INVALID_API_KEY', message: '请输入有效的 API Key。' },
          400,
        )
      }
      try {
        await models.saveApiKey(context.req.param('id')!, apiKey)
        return context.body(null, 204)
      } catch {
        return context.json(
          { code: 'CREDENTIAL_SAVE_FAILED', message: 'API Key 保存失败。' },
          400,
        )
      }
    },
    saveConfig: async (context: Context) => {
      const body = await context.req.json<unknown>().catch(() => undefined)
      if (!isProviderConfig(body)) {
        return context.json(
          { code: 'INVALID_PROVIDER_CONFIG', message: '模型配置无效。' },
          400,
        )
      }
      try {
        const providerId = context.req.param('id')!
        await models.saveProviderConfig(providerId, body)
        const provider = await models.getProviderInfo(providerId)
        return context.json(provider satisfies ProviderInfoDto | undefined)
      } catch (error) {
        const response = modelServiceError(error)
        return context.json(
          { code: response.code, message: response.message },
          response.status,
        )
      }
    },
  }
}
