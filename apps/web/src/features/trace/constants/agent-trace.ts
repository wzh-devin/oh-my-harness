import {
  AGENT_TRAJECTORY_LANE,
  AGENT_TRAJECTORY_RECORD_KIND,
  AGENT_TRAJECTORY_STATUS,
  type AgentTrajectoryRecordKind,
} from '@oh-my-harness/shared'

const TRACE_KIND_CHIP_CLASS_NAME =
  'h-4! min-h-4! rounded-sm! px-1.5 text-[10px]! leading-none font-semibold tracking-wide'

export const AGENT_TRACE_LANE_LABELS = {
  [AGENT_TRAJECTORY_LANE.INPUT]: '输入',
  [AGENT_TRAJECTORY_LANE.MODEL]: '模型',
  [AGENT_TRAJECTORY_LANE.TOOLS]: '工具',
} as const

export const AGENT_TRACE_KIND_LABELS = {
  [AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT]: 'ASSISTANT',
  [AGENT_TRAJECTORY_RECORD_KIND.CONTEXT]: 'CONTEXT',
  [AGENT_TRAJECTORY_RECORD_KIND.REQUEST]: 'REQUEST',
  [AGENT_TRAJECTORY_RECORD_KIND.SYSTEM]: 'SYSTEM',
  [AGENT_TRAJECTORY_RECORD_KIND.TOOL]: 'TOOL',
  [AGENT_TRAJECTORY_RECORD_KIND.USER]: 'USER',
} as const

export const AGENT_TRACE_KIND_STYLES = {
  [AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:color-mix(in_oklab,oklch(0.55_0.16_305)_16%,transparent)] [--chip-fg:oklch(0.46_0.14_305)]`,
    timelineClassName: 'bg-[oklch(0.55_0.16_305)]/65',
  },
  [AGENT_TRAJECTORY_RECORD_KIND.CONTEXT]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:var(--success-soft)] [--chip-fg:var(--success-soft-foreground)]`,
    timelineClassName: 'bg-success/65',
  },
  [AGENT_TRAJECTORY_RECORD_KIND.REQUEST]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:color-mix(in_oklab,var(--accent)_14%,transparent)] [--chip-fg:var(--accent)]`,
    timelineClassName: 'bg-accent/60',
  },
  [AGENT_TRAJECTORY_RECORD_KIND.SYSTEM]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:var(--default)] [--chip-fg:var(--default-foreground)]`,
    timelineClassName: 'bg-muted/70',
  },
  [AGENT_TRAJECTORY_RECORD_KIND.TOOL]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:color-mix(in_oklab,var(--warning)_10%,transparent)] [--chip-fg:oklch(0.68_0.16_55)]`,
    timelineClassName: 'bg-warning/60',
  },
  [AGENT_TRAJECTORY_RECORD_KIND.USER]: {
    chipClassName: `${TRACE_KIND_CHIP_CLASS_NAME} [--chip-bg:var(--accent-soft)] [--chip-fg:var(--accent-soft-foreground)]`,
    timelineClassName: 'bg-accent/75',
  },
} as const satisfies Record<
  AgentTrajectoryRecordKind,
  { chipClassName: string; timelineClassName: string }
>

export const AGENT_TRACE_STATUS_LABELS = {
  [AGENT_TRAJECTORY_STATUS.ABORTED]: '已中止',
  [AGENT_TRAJECTORY_STATUS.COMPLETED]: '已完成',
  [AGENT_TRAJECTORY_STATUS.FAILED]: '失败',
  [AGENT_TRAJECTORY_STATUS.INTERRUPTED]: '已中断',
  [AGENT_TRAJECTORY_STATUS.RUNNING]: '运行中',
} as const

export const AGENT_TRACE_STATUS_COLORS = {
  [AGENT_TRAJECTORY_STATUS.ABORTED]: 'warning',
  [AGENT_TRAJECTORY_STATUS.COMPLETED]: 'success',
  [AGENT_TRAJECTORY_STATUS.FAILED]: 'danger',
  [AGENT_TRAJECTORY_STATUS.INTERRUPTED]: 'warning',
  [AGENT_TRAJECTORY_STATUS.RUNNING]: 'accent',
} as const
