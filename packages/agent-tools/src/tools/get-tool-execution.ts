import type { AgentTool } from '@earendil-works/pi-agent-core'
import { BUILTIN_TOOL_NAME } from '../tool-names.ts'
import type { ToolExecutionSnapshot } from '../execution/tool-execution-manager.ts'

/** 查询函数由宿主绑定当前会话，executionId 不能跨会话读取。 */
export const createGetToolExecutionTool = (
  get: (executionId: string) => ToolExecutionSnapshot,
): AgentTool => ({
  name: BUILTIN_TOOL_NAME.GET_TOOL_EXECUTION,
  label: 'get tool execution',
  description:
    'Get the current state of a background tool execution in this session. This does not rerun or stop the tool.',
  parameters: {
    additionalProperties: false,
    properties: {
      executionId: { type: 'string', minLength: 1, maxLength: 128 },
    },
    required: ['executionId'],
    type: 'object',
  } as unknown as AgentTool['parameters'],
  async execute(_callId, input, signal) {
    signal?.throwIfAborted()
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid execution request.')
    const values = input as Record<string, unknown>
    if (
      Object.keys(values).length !== 1 ||
      typeof values.executionId !== 'string' ||
      !values.executionId ||
      values.executionId.length > 128
    )
      throw new Error('Invalid execution request.')
    const snapshot = get(values.executionId)
    return {
      content: [{ type: 'text', text: JSON.stringify(snapshot) }],
      details: {
        targetExecutionId: snapshot.executionId,
        state: snapshot.state,
      },
    }
  },
})
