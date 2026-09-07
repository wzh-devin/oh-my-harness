import type { AgentRuntimeEvent } from '../execution/runtime-event.ts'
import {
  redactTrajectoryValue,
  type AgentTrajectory,
  type AgentTrajectoryRecord,
} from './agent-trajectory.ts'

/** JSONL 边界做增量投影；token 只传输变化文本，不重复序列化历史或完整回复。 */
export class TrajectoryStream {
  snapshot?: AgentTrajectory

  private readonly send: (event: AgentRuntimeEvent) => void
  constructor(send: (event: AgentRuntimeEvent) => void) {
    this.send = send
  }

  publish(next: AgentTrajectory) {
    // ponytail: 边界按 O(n) 比较；超过已验证的 100 Run 再按日志游标增量投影。
    const previous = new Map(
      this.snapshot?.records.map((record) => [record.id, record]),
    )
    const records = next.records.filter(
      (record) =>
        JSON.stringify(previous.get(record.id)) !== JSON.stringify(record),
    )
    this.snapshot = next
    const { records: _records, ...trajectory } = next
    this.send({
      type: 'trajectory_updated',
      trajectory,
      records: structuredClone(records),
    })
  }

  delta(requestId: string, delta: string, block: 'text' | 'thinking') {
    const snapshot = this.snapshot
    const request = snapshot?.records.find((record) => record.id === requestId)
    if (!snapshot || request?.kind !== 'request') return
    const id = `${requestId}:assistant`
    let record = snapshot.records.find((item) => item.id === id)
    if (!record) {
      record = {
        ...request,
        id,
        position: snapshot.records.length,
        kind: 'assistant',
        label: 'Assistant 响应',
        sourceRecordId: requestId,
        source: request.source,
        preview: '',
        summary: '',
        raw: {},
        detail: { text: '', thinking: '' },
      }
      request.resultRecordId = id
      snapshot.records.push(record)
      const { records: _records, ...trajectory } = snapshot
      // revision distinguishes partial updates at the same durable JSONL sequence.
      trajectory.cursor = {
        ...snapshot.cursor,
        revision: snapshot.cursor.revision + 1,
      }
      snapshot.cursor = trajectory.cursor
      this.send({
        type: 'trajectory_updated',
        trajectory,
        records: structuredClone([request, record]),
      })
    }
    const safeDelta = redactTrajectoryValue(delta) as string
    record.detail = {
      ...record.detail,
      [block]: String(record.detail?.[block] ?? '') + safeDelta,
    }
    if (block === 'text') {
      record.preview += safeDelta
      record.summary = record.preview.replace(/\s+/gu, ' ').slice(0, 320)
    }
    snapshot.cursor = {
      ...snapshot.cursor,
      revision: snapshot.cursor.revision + 1,
    }
    this.send({
      type: 'trajectory_delta',
      cursor: snapshot.cursor,
      id,
      block,
      delta: safeDelta,
    })
  }
}

export type TrajectoryUpdate =
  | {
      type: 'trajectory_updated'
      trajectory: Omit<AgentTrajectory, 'records'>
      records: AgentTrajectoryRecord[]
    }
  | {
      type: 'trajectory_delta'
      cursor: AgentTrajectory['cursor']
      id: string
      block: 'text' | 'thinking'
      delta: string
    }
