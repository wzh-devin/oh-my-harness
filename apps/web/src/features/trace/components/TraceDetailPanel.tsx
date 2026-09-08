import { CodeBlock } from '@agile-avocation/ui-pro/code-block'
import {
  AGENT_TRAJECTORY_RECORD_KIND,
  AGENT_TRAJECTORY_STATUS,
} from '@oh-my-harness/shared'
import { Markdown } from '@agile-avocation/ui-pro/markdown'
import { Xmark } from '@gravity-ui/icons'
import { Button, Tabs } from '@heroui/react'
import { memo, useState, type ReactNode } from 'react'
import { AGENT_TRACE_STATUS_LABELS } from '../constants/agent-trace.ts'
import type { AgentTraceRecordDetail } from '../types/agent-trace.ts'
import { formatTraceDuration } from '../utils/format-trace-duration.ts'
import { TraceKindChip } from './TraceKindChip.tsx'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '未提供'
const tokens = (value: unknown) =>
  number(value) === undefined ? '未提供' : `${value} tok`
const ms = (value: unknown) =>
  number(value) === undefined ? '未提供' : formatTraceDuration(Number(value))

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="text-[13px] leading-[22px]">
      {rows.map(([label, value]) => (
        <div
          className="grid min-h-[22px] grid-cols-[94px_minmax(0,1fr)] items-center"
          key={label}
        >
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
function Json({ value }: { value: unknown }) {
  const code = JSON.stringify(value ?? null, null, 2)
  return (
    <CodeBlock className="min-w-0 rounded-md! border-0!">
      <CodeBlock.Header>
        <span>JSON</span>
        <CodeBlock.CopyButton aria-label="复制原始轨迹数据" code={code} />
      </CodeBlock.Header>
      <CodeBlock.Code code={code} language="json" />
    </CodeBlock>
  )
}
function Section({
  title,
  children,
  onOpen,
}: {
  title: string
  children: ReactNode
  onOpen?: () => void
}) {
  return (
    <section className="mb-4 min-w-0">
      <h3 className="mb-1.5 text-[13px] font-medium text-muted">
        {onOpen ? (
          <Button
            className="h-auto! min-h-0! justify-start p-0 text-[13px]"
            variant="ghost"
            onPress={onOpen}
          >
            {title} ›
          </Button>
        ) : (
          title
        )}
      </h3>
      {children}
    </section>
  )
}

interface TraceDetailPanelProps {
  record: AgentTraceRecordDetail
  startedAt: number
  onClose: () => void
  onNavigate: (id: string) => void
}

export const TraceDetailPanel = memo(function TraceDetailPanel({
  record,
  startedAt,
  onClose,
  onNavigate,
}: TraceDetailPanelProps) {
  const [tab, setTab] = useState(
    record.kind === AGENT_TRAJECTORY_RECORD_KIND.SYSTEM ? 'system' : 'summary',
  )
  const data = record.detail ?? {}
  const options = object(data.options)
  const usage = object(data.usage)
  const timing = object(data.timing)
  const blocks = Array.isArray(data.blocks) ? data.blocks.map(object) : []
  const thinking =
    blocks
      .filter((block) => block.type === 'thinking')
      .map((block) => text(block.thinking))
      .join('\n') || String(data.thinking ?? '')
  const calls = blocks.filter((block) => block.type === 'toolCall')
  const started = number(timing.startedAt) ?? startedAt + record.startMs
  const startedDate = new Date(started)
  const completed = number(timing.completedAt) ?? record.completedAt
  const firstToken = number(timing.firstTokenAt)
  const generation =
    completed !== undefined && firstToken !== undefined
      ? Math.max(0, completed - firstToken)
      : undefined
  const input = number(usage.input)
  const cached = number(usage.cacheRead)
  const totalInput =
    input === undefined
      ? undefined
      : input + (cached ?? 0) + (number(usage.cacheWrite) ?? 0)
  const navigation = (id: string | undefined, label: string) =>
    id ? (
      <Button
        className="h-auto! min-h-0! justify-start p-0 text-xs text-accent"
        variant="ghost"
        onPress={() => onNavigate(id)}
      >
        {label} ›
      </Button>
    ) : (
      '未提供'
    )
  const timingPanel = (
    <Fields
      rows={[
        [
          'Started',
          `${startedDate.toLocaleString('sv-SE')}.${String(startedDate.getMilliseconds()).padStart(3, '0')}`,
        ],
        [
          'Total duration',
          ms(
            completed === undefined
              ? record.status === AGENT_TRAJECTORY_STATUS.RUNNING
                ? record.durationMs
                : undefined
              : completed - started,
          ),
        ],
        [
          'TTFT',
          ms(firstToken === undefined ? undefined : firstToken - started),
        ],
        ['Generation', ms(generation)],
        [
          'Throughput',
          generation && number(usage.output) !== undefined
            ? `${((Number(usage.output) * 1000) / generation).toFixed(1)} tok/s`
            : '未提供',
        ],
      ]}
    />
  )
  const usagePanel = (
    <Fields
      rows={[
        ['输入', tokens(totalInput)],
        ['缓存读取', tokens(cached)],
        ['缓存写入', tokens(usage.cacheWrite)],
        ['未缓存输入', tokens(input)],
        ['输出', tokens(usage.output)],
        ['推理', tokens(usage.reasoning)],
        ['正文', tokens(usage.content)],
        ['总计', tokens(usage.total ?? usage.totalTokens)],
      ]}
    />
  )
  const preview = (
    <div className="space-y-2 text-[13px] leading-5">
      {thinking ? (
        <details open className="border-l-2 border-separator pl-2">
          <summary className="cursor-pointer text-muted">Thinking</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{thinking}</p>
        </details>
      ) : null}
      {record.kind === AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT ? (
        <Markdown className="text-[13px]! leading-5! [&>*]:text-[13px]! [&>*]:leading-5! [&_li]:my-1!">
          {record.preview ||
            (record.status === AGENT_TRAJECTORY_STATUS.RUNNING
              ? '等待模型输出…'
              : '无文本内容。')}
        </Markdown>
      ) : (
        <p className="whitespace-pre-wrap break-words">
          {record.preview || '无文本内容。'}
        </p>
      )}
      {calls.map((call, index) => (
        <details key={String(call.id ?? index)}>
          <summary className="cursor-pointer text-muted">
            工具调用 · {text(call.name)}
          </summary>
          <Json value={call.arguments} />
        </details>
      ))}
    </div>
  )
  const source = (
    <Fields
      rows={[
        ['记录 ID', record.id],
        ['Run ID', record.runId],
        ['Turn', record.turn ? text(record.turn) : '—'],
        ['采集来源', record.source],
        [
          '来源节点',
          navigation(
            record.sourceRecordId,
            record.kind === AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT ||
              record.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL
              ? `Request #${record.request}`
              : 'System Prompt',
          ),
        ],
      ]}
    />
  )
  const summary =
    record.kind === AGENT_TRAJECTORY_RECORD_KIND.ASSISTANT ? (
      <>
        <div className="mb-5">
          <Fields
            rows={[
              [
                'Source',
                navigation(record.sourceRecordId, `Request #${record.request}`),
              ],
              ['Status', AGENT_TRACE_STATUS_LABELS[record.status]],
              ['Tokens', tokens(usage.output)],
              ['Reasoning', tokens(usage.reasoning)],
              ['Content', tokens(usage.content)],
            ]}
          />
        </div>
        <Section title="Preview" onOpen={() => setTab('preview')}>
          {preview}
        </Section>
        <Section
          title="Request Timing"
          onOpen={
            record.sourceRecordId
              ? () => onNavigate(record.sourceRecordId!)
              : undefined
          }
        >
          {timingPanel}
        </Section>
      </>
    ) : (
      <>
        <div className="mb-5">
          <Fields
            rows={[
              ['Status', AGENT_TRACE_STATUS_LABELS[record.status]],
              ...(record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST
                ? []
                : ([['Source', record.source]] as [string, ReactNode][])),
              ...(record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST
                ? ([
                    ['Provider', text(options.provider)],
                    ['Model', text(options.model)],
                    ['Tool calls', text(data.toolCalls)],
                    [
                      'Result',
                      navigation(record.resultRecordId, 'Assistant Message'),
                    ],
                  ] as [string, ReactNode][])
                : []),
            ]}
          />
        </div>
        {record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST ? (
          <>
            <Section title="Options" onOpen={() => setTab('options')}>
              <Json value={options} />
            </Section>
            <Section title="Usage" onOpen={() => setTab('usage')}>
              {usagePanel}
            </Section>
            <Section title="Timing" onOpen={() => setTab('timing')}>
              {timingPanel}
            </Section>
          </>
        ) : (
          <Section title="Preview">{preview}</Section>
        )}
      </>
    )
  const toolDefinitions = Array.isArray(data.tools)
    ? data.tools.map(object)
    : []
  const tools = toolDefinitions.length ? (
    toolDefinitions.map((tool, index) => (
      <details
        className="border-b border-separator py-2"
        key={`${tool.name}:${index}`}
      >
        <summary className="cursor-pointer truncate text-xs">
          <span className="font-mono">{text(tool.name)}</span>
          <span className="ml-2 text-muted">{text(tool.description)}</span>
        </summary>
        <p className="my-2 whitespace-pre-wrap text-xs text-muted">
          {text(tool.description)}
        </p>
        <Json value={tool.parameters} />
      </details>
    ))
  ) : (
    <p className="text-xs text-muted">本次请求没有工具。</p>
  )
  const tabs: { id: string; title: string; content: ReactNode }[] =
    record.kind === AGENT_TRAJECTORY_RECORD_KIND.SYSTEM
      ? [
          { id: 'system', title: 'System Prompt', content: preview },
          { id: 'tools', title: 'Tools', content: tools },
          ...(data.previous
            ? [
                {
                  id: 'diff',
                  title: 'Diff',
                  content: (
                    <>
                      <Section title="更新前">
                        <Json value={data.previous} />
                      </Section>
                      <Section title="更新后">
                        <Json
                          value={{ system: data.system, tools: data.tools }}
                        />
                      </Section>
                    </>
                  ),
                },
              ]
            : []),
        ]
      : record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST
        ? [
            { id: 'summary', title: 'Summary', content: summary },
            {
              id: 'options',
              title: 'Options',
              content: <Json value={options} />,
            },
            { id: 'usage', title: 'Usage', content: usagePanel },
            { id: 'timing', title: 'Timing', content: timingPanel },
          ]
        : [
            {
              id: 'summary',
              title: 'Summary',
              content:
                record.kind === AGENT_TRAJECTORY_RECORD_KIND.TOOL ? (
                  <>
                    <Section title="状态">
                      {AGENT_TRACE_STATUS_LABELS[record.status]} ·{' '}
                      {ms(record.durationMs)}
                    </Section>
                    <Section title="输入">
                      <Json value={data.input} />
                    </Section>
                    <Section title="输出">{preview}</Section>
                  </>
                ) : (
                  summary
                ),
            },
            { id: 'preview', title: 'Preview', content: preview },
            {
              id: 'raw',
              title: 'Raw',
              content: (
                <>
                  <Json value={record.raw} />
                  <Section title="Source">{source}</Section>
                </>
              ),
            },
          ]

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-separator pr-2 pl-3">
        {record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST ? (
          <span aria-hidden>•</span>
        ) : (
          <TraceKindChip kind={record.kind} />
        )}
        {record.kind === AGENT_TRAJECTORY_RECORD_KIND.REQUEST ? (
          <span className="text-xs font-medium">{record.label}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {record.kind === AGENT_TRAJECTORY_RECORD_KIND.SYSTEM
            ? record.label
            : `Run ${record.runNumber}${record.turn ? ` · Turn ${record.turn}` : ''}`}
        </span>
        <Button
          isIconOnly
          aria-label="关闭轨迹详情"
          className="-mr-2"
          size="sm"
          variant="ghost"
          onPress={onClose}
        >
          <Xmark className="size-3.5" />
        </Button>
      </div>
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0!"
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key))}
        variant="secondary"
      >
        <Tabs.ListContainer className="h-[34px] shrink-0 px-2">
          <Tabs.List
            className="h-[34px] min-w-0! w-max! justify-start gap-px"
            aria-label="轨迹详情分类"
          >
            {tabs.map((tab) => (
              <Tabs.Tab
                className="h-[34px]! w-auto! flex-none! px-[9px]! text-[13px] font-normal data-[selected=true]:text-accent!"
                id={tab.id}
                key={tab.id}
              >
                {tab.title}
                <Tabs.Indicator className="inset-x-[9px]! w-auto!" />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tab) => (
          <Tabs.Panel
            className="mt-0! min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[14px] py-2"
            id={tab.id}
            key={tab.id}
          >
            {tab.content}
          </Tabs.Panel>
        ))}
      </Tabs>
    </aside>
  )
})
