import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  createReadTool as createPiReadTool,
  formatSize,
  getOrThrow,
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionToolContext,
  type ReadToolDetails,
} from '@earendil-works/pi-agent-core'
import type { WorkspaceExecutionEnv } from '../workspace/execution-env.ts'

const IMAGE_PATH = /\.(?:bmp|gif|jpe?g|png|webp)$/iu
const IMAGE_SIGNATURE_BYTES = 12

const hasSignature = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte)

const mightBeImage = (bytes: Uint8Array) =>
  hasSignature(bytes, [0xff, 0xd8, 0xff]) ||
  hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
  hasSignature(bytes, [0x47, 0x49, 0x46]) ||
  (hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasSignature(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) ||
  hasSignature(bytes, [0x42, 0x4d])

interface ReadInput {
  limit?: number
  offset?: number
  path: string
}

const parameters = {
  additionalProperties: false,
  properties: {
    limit: {
      description: 'Maximum number of lines to read',
      maximum: DEFAULT_MAX_LINES,
      minimum: 1,
      type: 'integer',
    },
    offset: {
      description: 'Line number to start reading from (1-indexed)',
      minimum: 1,
      type: 'integer',
    },
    path: {
      description: 'Path to the file to read (relative or absolute)',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['path'],
  type: 'object',
} as unknown as AgentTool['parameters']

const parseReadInput = (input: unknown): ReadInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Read input is invalid.')
  const values = input as Record<string, unknown>
  if (
    Object.keys(values).some(
      (key) => !['path', 'offset', 'limit'].includes(key),
    ) ||
    typeof values.path !== 'string' ||
    !values.path ||
    (values.offset !== undefined &&
      (!Number.isSafeInteger(values.offset) ||
        (values.offset as number) < 1)) ||
    (values.limit !== undefined &&
      (!Number.isSafeInteger(values.limit) ||
        (values.limit as number) < 1 ||
        (values.limit as number) > DEFAULT_MAX_LINES))
  )
    throw new Error('Read input is invalid.')
  return {
    path: values.path,
    ...(values.offset === undefined ? {} : { offset: values.offset as number }),
    ...(values.limit === undefined ? {} : { limit: values.limit as number }),
  }
}

interface ReadDetails extends ReadToolDetails {
  pagination?: {
    endLine: number
    nextOffset: number | null
    startLine: number
  }
}

/** 普通读取与图片交给 Pi；显式文本分页只保留当前页。 */
export const createReadTool = (): AgentHarnessTool<
  ExecutionToolContext,
  AgentTool['parameters'],
  ReadDetails | undefined
> => {
  const tool = createPiReadTool()
  return {
    ...tool,
    description:
      'Primary tool for inspecting local file contents, including source code and configuration. Use this instead of bash cat, head, tail, or sed when reading known files. For large text files, set limit and follow pagination.nextOffset until it is null. For multiple files, issue one read call per file; multiple read calls can be returned together. ' +
      tool.description,
    parameters,
    async execute(toolCallId, input, signal, onUpdate, context) {
      const parsed = parseReadInput(input)
      const paginated =
        parsed.offset !== undefined || parsed.limit !== undefined
      if (!paginated || IMAGE_PATH.test(parsed.path))
        return tool.execute(toolCallId, parsed, signal, onUpdate, context)

      const env = context.env as WorkspaceExecutionEnv
      const prefix = getOrThrow(
        await env.readBinaryPrefix(parsed.path, IMAGE_SIGNATURE_BYTES, signal),
      )
      if (mightBeImage(prefix))
        return tool.execute(toolCallId, parsed, signal, onUpdate, context)

      const offset = parsed.offset ?? 1
      const limit = parsed.limit ?? DEFAULT_MAX_LINES
      const page = getOrThrow(
        await env.readTextPage(parsed.path, {
          abortSignal: signal,
          limit,
          maxBytes: DEFAULT_MAX_BYTES,
          offset,
        }),
      )
      if (page.firstLineBytes !== undefined) {
        return {
          content: [
            {
              type: 'text',
              text: `[Line ${offset} is ${formatSize(page.firstLineBytes)}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use a targeted byte-range command if this content is required.]`,
            },
          ],
          details: {
            pagination: {
              endLine: offset,
              nextOffset: null,
              startLine: offset,
            },
          },
        }
      }

      const content = page.lines.join('\n')
      const footer = page.lines.length
        ? page.nextOffset === null
          ? `[Showing lines ${page.startLine}-${page.endLine}; end of file.]`
          : `[Showing lines ${page.startLine}-${page.endLine}. Use offset=${page.nextOffset} to continue.]`
        : '[File is empty; end of file.]'
      return {
        content: [
          {
            type: 'text',
            text: `${content}${content ? '\n\n' : ''}${footer}`,
          },
        ],
        details: {
          pagination: {
            endLine: page.endLine,
            nextOffset: page.nextOffset,
            startLine: page.startLine,
          },
        },
      }
    },
  }
}
