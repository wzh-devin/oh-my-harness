import type {
  AgentTraceFilters,
  AgentTraceRecord,
} from '../types/agent-trace.ts'
import { AGENT_TRAJECTORY_RECORD_KIND } from '@oh-my-harness/shared'

/** 同一维度多选为或，不同维度为且；工具名称只匹配实际 TOOL 执行记录。 */
export const filterTraceRecords = (
  records: readonly AgentTraceRecord[],
  filters: AgentTraceFilters,
  searchRecordIds: ReadonlySet<string> | null,
): AgentTraceRecord[] =>
  records.filter(
    (record) =>
      (searchRecordIds === null || searchRecordIds.has(record.id)) &&
      (!filters.kinds.length || filters.kinds.includes(record.kind)) &&
      (!filters.statuses.length || filters.statuses.includes(record.status)) &&
      (!filters.toolNames.length ||
        (record.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL &&
          filters.toolNames.includes(record.label))),
  )
