import type { AgentTraceUpdate } from './agent-trace-api.ts'

const listeners = new Map<string, Set<(event: AgentTraceUpdate) => void>>()
export function publishTraceUpdate(sessionId: string, event: AgentTraceUpdate) {
  for (const listener of listeners.get(sessionId) ?? []) listener(event)
}
export function subscribeTraceUpdates(
  sessionId: string,
  listener: (event: AgentTraceUpdate) => void,
) {
  const group = listeners.get(sessionId) ?? new Set()
  group.add(listener)
  listeners.set(sessionId, group)
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(sessionId)
  }
}
