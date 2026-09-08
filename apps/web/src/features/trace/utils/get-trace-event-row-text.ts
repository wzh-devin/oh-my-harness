import { AGENT_TRAJECTORY_RECORD_KIND } from '@oh-my-harness/shared'
import { type AgentTraceRecord } from '../types/agent-trace'

export function getTraceEventRowText(record: AgentTraceRecord): string {
  return record.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL
    ? `${record.label} ${record.summary}`
    : record.summary
}
