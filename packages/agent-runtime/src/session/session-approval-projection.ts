import type { Entry } from '@earendil-works/pi-agent-core'
import {
  parseSessionApprovalGrant,
  sessionApprovalKey,
  type SessionApprovalGrant,
} from '@oh-my-harness/agent-policy'
import {
  APPROVAL_DECISION,
  APPROVAL_RESOLUTION_REASON,
  SESSION_CUSTOM_TYPE,
} from '@oh-my-harness/shared'

/** 当前分支 JSONL 是会话授权的唯一事实源。 */
export function projectSessionApprovals(
  entries: readonly Entry[],
): Map<string, SessionApprovalGrant> {
  const grants = new Map<string, SessionApprovalGrant>()
  for (const entry of entries) {
    if (
      entry.type !== 'custom' ||
      entry.customType !== SESSION_CUSTOM_TYPE.APPROVAL_RESOLVED ||
      !entry.data ||
      typeof entry.data !== 'object' ||
      Array.isArray(entry.data)
    )
      continue
    const data = entry.data as Record<string, unknown>
    if (
      data.decision !== APPROVAL_DECISION.APPROVE_SESSION ||
      data.reason !== APPROVAL_RESOLUTION_REASON.USER
    )
      continue
    const grant = parseSessionApprovalGrant(data.grant)
    if (grant) grants.set(sessionApprovalKey(grant), grant)
  }
  return grants
}
