export const AGENT_OPERATION_KIND = {
  MUTATION: 'mutation',
  RUN: 'run',
} as const
export type AgentOperationKind =
  (typeof AGENT_OPERATION_KIND)[keyof typeof AGENT_OPERATION_KIND]
