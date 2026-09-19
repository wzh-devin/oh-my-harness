import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from '../../../../components/assistant-ui/index.ts'
import type { ChatMessageReasoning } from '../../types/chat-types.ts'

interface ReasoningPanelProps {
  reasoning: ChatMessageReasoning
  streaming?: boolean
}

/** 展示可折叠推理内容，并在当前片段流式输出时自动展开。 */
export function ReasoningPanel({ reasoning, streaming }: ReasoningPanelProps) {
  return (
    <ReasoningRoot
      defaultOpen={reasoning.defaultExpanded ?? false}
      streaming={streaming}
      variant="ghost"
    >
      <ReasoningTrigger active={streaming} duration={reasoning.duration} />
      <ReasoningContent>
        <ReasoningText>
          {reasoning.steps.map((step, stepIndex) => (
            <section key={`${step.label}-${stepIndex}`}>
              <h4 className="font-medium text-foreground">{step.label}</h4>
              <p className="mt-1 text-pretty">{step.content}</p>
            </section>
          ))}
        </ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}
