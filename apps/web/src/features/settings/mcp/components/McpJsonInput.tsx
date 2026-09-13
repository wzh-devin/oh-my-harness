import {
  useEffect,
  useId,
  useState,
  type ComponentType,
  type RefObject,
} from 'react'
import { TextArea } from '@heroui/react'
import type { McpJsonCodeEditorProps } from '../types/mcp-json-editor-props.ts'

/** 按需加载 MCP JSON 编辑能力；加载失败仍可使用原生文本输入保留草稿。 */
export function McpJsonInput({ editorRef, ...props }: McpJsonCodeEditorProps) {
  const [CodeEditor, setCodeEditor] =
    useState<ComponentType<McpJsonCodeEditorProps>>()
  const [failed, setFailed] = useState(false)
  const hintId = useId()
  useEffect(() => {
    let active = true
    void import('./McpJsonCodeEditor.tsx')
      .then((module) => {
        if (active) setCodeEditor(() => module.McpJsonCodeEditor)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <>
      {CodeEditor ? (
        <CodeEditor
          {...props}
          editorRef={editorRef}
          describedBy={`${props.describedBy ?? ''} ${hintId}`.trim()}
        />
      ) : (
        <TextArea
          variant="secondary"
          ref={editorRef as RefObject<HTMLTextAreaElement | null>}
          className="w-full !font-mono whitespace-pre-wrap break-words"
          aria-label={props.label}
          aria-describedby={props.describedBy}
          disabled={props.isDisabled}
          autoFocus={props.autoFocus}
          rows={props.compact ? 5 : 17}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {CodeEditor ? (
        <p id={hintId} className="sr-only">
          Tab 缩进 · Shift Tab 反缩进 · Esc 后 Tab 离开编辑区
        </p>
      ) : failed ? (
        <p className="text-xs text-muted" role="status">
          代码编辑器加载失败，可继续编辑或重新打开重试。
        </p>
      ) : null}
    </>
  )
}
