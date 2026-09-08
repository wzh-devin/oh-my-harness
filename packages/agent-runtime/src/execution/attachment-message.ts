import { CAPABILITY_KIND } from '@oh-my-harness/shared'

import type {
  AgentMessageAttachment,
  AgentMessageContextItem,
} from './run-input.ts'
export interface StoredAttachment extends AgentMessageAttachment {
  path: string
}

export interface StructuredMessageDetails {
  attachments: StoredAttachment[]
  content: string
  contextItems: AgentMessageContextItem[]
  schemaVersion: 1
}

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export const attachmentManifest = (
  attachments: readonly StoredAttachment[],
) => ({
  text: [
    '<attachments>',
    ...attachments.map(
      (attachment) =>
        `  <attachment id="${escapeXml(attachment.id)}" name="${escapeXml(attachment.name)}" mime_type="${escapeXml(attachment.mimeType)}" size="${attachment.size}" path="${escapeXml(attachment.path)}" />`,
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
    details.schemaVersion !== 1 ||
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
        typeof item.path !== 'string' ||
        !item.path
      ) {
        return []
      }
      return [
        {
          id: item.id,
          mimeType: item.mimeType,
          name: item.name,
          size: item.size,
          path: item.path,
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
