import {
  convertToLlm,
  type AgentMessage,
  type Entry,
} from '@earendil-works/pi-agent-core'
import {
  ATTACHMENT_KIND,
  CAPABILITY_KIND,
  type AttachmentKind,
} from '@oh-my-harness/shared'

import type {
  AgentMessageAttachment,
  AgentMessageContextItem,
} from './run-input.ts'
import { SESSION_CUSTOM_TYPE } from '../session/session-custom-type.ts'

export interface StoredAttachment extends AgentMessageAttachment {
  content: string
  kind: AttachmentKind
}

export interface StructuredMessageDetails {
  attachments: StoredAttachment[]
  content: string
  contextItems: AgentMessageContextItem[]
  schemaVersion: 2
}

export interface SessionAttachmentResource {
  content: string
  id: string
  kind: AttachmentKind
  mimeType: string
  name: string
}

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export const attachmentManifest = (
  attachments: readonly AgentMessageAttachment[],
) => ({
  text: [
    '<attachments>',
    ...attachments.map(
      (attachment) =>
        `  <attachment id="${escapeXml(attachment.id)}" name="${escapeXml(attachment.name)}" mime_type="${escapeXml(attachment.mimeType)}" size="${attachment.size}" />`,
    ),
    '</attachments>',
  ].join('\n'),
  type: 'text' as const,
})

export function structuredMessageDetails(
  value: unknown,
): StructuredMessageDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const details = value as Record<string, unknown>
  if (
    details.schemaVersion !== 2 ||
    typeof details.content !== 'string' ||
    !Array.isArray(details.attachments) ||
    !Array.isArray(details.contextItems)
  ) {
    return undefined
  }
  const schemaVersion = details.schemaVersion
  const attachments = details.attachments.flatMap<StoredAttachment>(
    (attachment) => {
      if (
        !attachment ||
        typeof attachment !== 'object' ||
        Array.isArray(attachment)
      ) {
        return []
      }
      const item = attachment as Record<string, unknown>
      if (
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.mimeType !== 'string' ||
        typeof item.size !== 'number' ||
        !Number.isSafeInteger(item.contentIndex) ||
        (item.contentIndex as number) < 0 ||
        typeof item.content !== 'string' ||
        (item.kind !== ATTACHMENT_KIND.IMAGE &&
          item.kind !== ATTACHMENT_KIND.TEXT)
      ) {
        return []
      }
      return [
        {
          contentIndex: item.contentIndex as number,
          id: item.id,
          mimeType: item.mimeType,
          name: item.name,
          size: item.size,
          content: item.content,
          kind: item.kind,
        },
      ]
    },
  )
  if (attachments.length !== details.attachments.length) return undefined
  const contextItems = details.contextItems.flatMap<AgentMessageContextItem>(
    (contextItem) => {
      if (
        !contextItem ||
        typeof contextItem !== 'object' ||
        Array.isArray(contextItem)
      ) {
        return []
      }
      const item = contextItem as Record<string, unknown>
      return typeof item.id === 'string' &&
        (item.kind === CAPABILITY_KIND.COMMAND ||
          item.kind === CAPABILITY_KIND.SKILL ||
          item.kind === CAPABILITY_KIND.PLUGIN) &&
        typeof item.label === 'string' &&
        typeof item.description === 'string' &&
        typeof item.reference === 'string' &&
        typeof item.sourceId === 'string'
        ? [
            {
              description: item.description,
              id: item.id,
              kind: item.kind,
              label: item.label,
              reference: item.reference,
              sourceId: item.sourceId,
            },
          ]
        : []
    },
  )
  if (contextItems.length !== details.contextItems.length) return undefined
  return {
    attachments,
    content: details.content,
    contextItems,
    schemaVersion,
  }
}

export const modelSafeAttachmentMessage = (
  message: AgentMessage,
): AgentMessage => {
  if (
    message.role !== 'custom' ||
    message.customType !== SESSION_CUSTOM_TYPE.USER_INPUT
  ) {
    return message
  }
  const details = structuredMessageDetails(message.details)
  if (!details) {
    return {
      ...message,
      content: [
        {
          text: '[Structured user input could not be restored safely.]',
          type: 'text',
        },
      ],
    }
  }
  return message
}

export const convertAttachmentMessagesToLlm = (messages: AgentMessage[]) =>
  convertToLlm(messages.map(modelSafeAttachmentMessage))

export const modelSafeAttachmentEntries = (entries: Entry[]) =>
  entries.map((entry) =>
    entry.type === 'message'
      ? { ...entry, message: modelSafeAttachmentMessage(entry.message) }
      : entry,
  ) as Entry[]

export const attachmentResourcesFromEntries = (
  entries: readonly Entry[],
  incoming?: AgentMessage,
) => {
  const messages = [
    ...entries.flatMap((entry) =>
      entry.type === 'message' ? [entry.message] : [],
    ),
    ...(incoming ? [incoming] : []),
  ]
  const resources = new Map<string, SessionAttachmentResource>()
  for (const message of messages) {
    if (
      message.role !== 'custom' ||
      message.customType !== SESSION_CUSTOM_TYPE.USER_INPUT
    ) {
      continue
    }
    const details = structuredMessageDetails(message.details)
    if (!details) continue
    for (const attachment of details.attachments) {
      resources.set(attachment.id, {
        content: attachment.content,
        id: attachment.id,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        name: attachment.name,
      })
    }
  }
  return [...resources.values()]
}
