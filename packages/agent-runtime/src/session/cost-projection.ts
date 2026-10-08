/** JSONL 到 SQLite 请求成本的最小投影能力。 */
export interface AgentCostProjection {
  getCostSince(timestamp: number): Promise<number>
}
