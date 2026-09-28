import type { ComponentProps } from 'react'
import { CodeBlock } from '@agile-avocation/ui-pro/code-block'
import { Markdown, markdownVariants } from '@agile-avocation/ui-pro/markdown'
import {
  FileReferenceIcon,
  getWorkspaceFileReference,
  useChatWorkspace,
} from '../../workspace/index.ts'

const markdownSlots = markdownVariants()

const LOCALIZED_COMPONENTS = {
  code: function LocalizedCode({ children, className, node, ...props }) {
    const { onFileOpen, selectedWorkspaceId } = useChatWorkspace()
    const isInline =
      !node?.position?.start.line ||
      node.position.start.line === node.position.end.line

    if (isInline) {
      const fileReference = getWorkspaceFileReference(String(children ?? ''))
      if (fileReference && selectedWorkspaceId && onFileOpen) {
        return (
          <button
            aria-label={`使用本地应用打开 ${fileReference.path}`}
            className="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded px-0.5 align-middle font-sans text-sm text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            title={fileReference.path}
            type="button"
            onClick={() => onFileOpen(fileReference.path)}
          >
            <FileReferenceIcon label={fileReference.label} />
            <span className="min-w-0 break-all">{fileReference.name}</span>
          </button>
        )
      }

      return (
        <code
          className={`${markdownSlots.inlineCode()} ${className ?? ''}`.trim()}
          {...props}
        >
          {children}
        </code>
      )
    }

    const code = String(children ?? '').replace(/\n$/, '')
    const language = className?.match(/language-(\w+)/)?.[1] ?? 'plaintext'

    return (
      <CodeBlock>
        <CodeBlock.Header>
          <span className="text-xs text-muted uppercase">{language}</span>
          <CodeBlock.CopyButton aria-label="复制代码" code={code} />
        </CodeBlock.Header>
        <CodeBlock.Code code={code} language={language} />
      </CodeBlock>
    )
  },
} satisfies NonNullable<ComponentProps<typeof Markdown>['components']>

interface MessageMarkdownProps {
  children: string
}

/** 使用 UI Pro 渲染消息 Markdown，并提供中文复制名称。 */
export function MessageMarkdown({ children }: MessageMarkdownProps) {
  return <Markdown components={LOCALIZED_COMPONENTS}>{children}</Markdown>
}
