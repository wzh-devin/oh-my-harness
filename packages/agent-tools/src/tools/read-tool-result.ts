import type { AgentTool } from '@earendil-works/pi-agent-core'
import { BUILTIN_TOOL_NAME } from '../tool-names.ts'

/** 读取函数由宿主绑定当前会话，模型不能选择其他会话或文件路径。 */
export const createReadToolResultTool = (
  read: (toolCallId: string) => Promise<string | undefined>,
  maxChars = 16_000,
): AgentTool => ({
  name: BUILTIN_TOOL_NAME.READ_TOOL_RESULT,
  label: 'read tool result',
  description:
    'Read original text from a completed tool call in this session. Use character offset and limit to page through shortened output; nextOffset identifies the next page. This does not rerun the tool.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      toolCallId: { type: 'string', minLength: 1, maxLength: 256 },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: maxChars },
    },
    required: ['toolCallId'],
  } as unknown as AgentTool['parameters'],
  async execute(_callId, input, signal) {
    signal?.throwIfAborted()
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid tool result request.')
    const args = input as Record<string, unknown>
    const offset = args.offset === undefined ? 0 : args.offset
    const limit =
      args.limit === undefined ? Math.min(8000, maxChars) : args.limit
    if (
      Object.keys(args).some(
        (key) => !['toolCallId', 'offset', 'limit'].includes(key),
      ) ||
      typeof args.toolCallId !== 'string' ||
      !args.toolCallId.trim() ||
      args.toolCallId.length > 256 ||
      !Number.isSafeInteger(offset) ||
      (offset as number) < 0 ||
      !Number.isSafeInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > maxChars
    )
      throw new Error('Invalid tool result request.')
    const text = await read(args.toolCallId)
    signal?.throwIfAborted()
    if (text === undefined)
      throw new Error('Tool result was not found in this session.')
    const characters = Array.from(text)
    if ((offset as number) > characters.length)
      throw new Error('Offset exceeds tool result length.')
    const end = Math.min(
      characters.length,
      (offset as number) + (limit as number),
    )
    return {
      content: [
        {
          type: 'text',
          text: `[Tool result ${args.toolCallId}; offset=${offset}; nextOffset=${end < characters.length ? end : 'end'}; totalCharacters=${characters.length}]\n${characters.slice(offset as number, end).join('') || '(no text output)'}`,
        },
      ],
      details: {
        toolCallId: args.toolCallId,
        offset,
        nextOffset: end < characters.length ? end : null,
        totalCharacters: characters.length,
      },
    }
  },
})
