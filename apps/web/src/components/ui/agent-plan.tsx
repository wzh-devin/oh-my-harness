import type { AgentPlanProps, PlanStepState } from '../../types/agent-plan.ts'
import { PLAN_STEP_STATE } from '@oh-my-harness/shared'

const markClassName =
  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border'

function Mark({ state }: { state: PlanStepState }) {
  if (state === PLAN_STEP_STATE.DONE) {
    return (
      <span
        aria-hidden="true"
        className={`${markClassName} border-success bg-success text-success-foreground`}
      >
        <svg
          fill="none"
          height="9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
          viewBox="0 0 24 24"
          width="9"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    )
  }

  if (state === PLAN_STEP_STATE.ACTIVE) {
    return (
      <span
        aria-hidden="true"
        className={`${markClassName} border-accent text-accent`}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      </span>
    )
  }

  if (state === PLAN_STEP_STATE.FAILED) {
    return (
      <span
        aria-hidden="true"
        className={`${markClassName} border-danger bg-danger text-danger-foreground`}
      >
        <svg
          fill="none"
          height="9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3.5"
          viewBox="0 0 24 24"
          width="9"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    )
  }

  if (state === PLAN_STEP_STATE.SKIPPED) {
    return (
      <span
        aria-hidden="true"
        className={`${markClassName} border-divider text-muted`}
      >
        <svg
          fill="none"
          height="9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
          width="9"
        >
          <path d="M5 12h14" />
        </svg>
      </span>
    )
  }

  return (
    <span aria-hidden="true" className={`${markClassName} border-divider`} />
  )
}

/** 展示 Agent 在执行过程中维护和修订的步骤列表。 */
export function AgentPlan({ className = '', steps }: AgentPlanProps) {
  return (
    <section
      className={`flex max-h-[min(44svh,24rem)] flex-col overflow-hidden rounded-2xl border border-divider bg-surface ${className}`}
      data-slot="agent-plan"
    >
      <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-4 overscroll-contain">
        {steps.map((step, index) => (
          <li className="relative flex gap-3 pb-4 last:pb-0" key={step.id}>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-5 left-2 h-[calc(100%-1.25rem)] w-px bg-divider"
              />
            ) : null}
            <Mark state={step.state} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`text-sm leading-5 ${
                    step.state === PLAN_STEP_STATE.SKIPPED
                      ? 'text-muted line-through decoration-divider'
                      : step.state === PLAN_STEP_STATE.DONE
                        ? 'text-muted'
                        : 'text-foreground'
                  }`}
                >
                  {step.text}
                </span>
                {step.added ? (
                  <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-px text-[11px] font-medium text-accent">
                    新增
                  </span>
                ) : null}
              </div>
              {step.note ? (
                <p className="mt-1 text-xs leading-4 text-muted">{step.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
