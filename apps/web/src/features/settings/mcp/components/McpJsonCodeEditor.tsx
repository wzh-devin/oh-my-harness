import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
} from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import type { McpJsonCodeEditorProps } from '../types/mcp-json-editor-props.ts'
import { secretWidgets } from './mcp-secret-widgets.tsx'
import { McpSecretValue } from './McpSecretValue.tsx'

const theme = EditorView.theme({
  '&': {
    height: 'var(--mcp-json-editor-height)',
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '14px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.75',
  },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 12px' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor:
        'color-mix(in oklab, var(--foreground) 12%, transparent)',
    },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklab, var(--foreground) 10%, transparent)',
    outline: 'none',
    borderRadius: '2px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--foreground)',
    border: '1px solid var(--divider)',
    borderRadius: '8px',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
})
const highlighting = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--foreground)' },
  {
    tag: tags.string,
    color: 'color-mix(in oklab, var(--success) 45%, var(--foreground))',
  },
  {
    tag: [tags.bool, tags.null],
    color: 'color-mix(in oklab, var(--accent) 60%, var(--foreground))',
  },
  {
    tag: tags.number,
    color: 'color-mix(in oklab, var(--warning) 40%, var(--foreground))',
  },
  { tag: tags.punctuation, color: 'var(--muted)' },
])

/** 为 MCP 草稿提供编辑历史与 JSON 语法辅助；配置校验和保存仍由父级负责。 */
export function McpJsonCodeEditor({
  value,
  isDisabled,
  onChange,
  editorRef,
  label,
  describedBy,
  compact,
  autoFocus,
  secretKeys,
  readSecret,
}: McpJsonCodeEditorProps) {
  const container = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialValue = useRef(value)
  const [editable] = useState(() => new Compartment())
  const [secrets] = useState(() => new Compartment())
  const [secretElements, setSecretElements] = useState<
    { element: HTMLElement; key: string }[]
  >([])
  const changeSecretElement = useCallback(
    (element: HTMLElement, key?: string) => {
      setSecretElements((current) => [
        ...current.filter((item) => item.element !== element),
        ...(key === undefined ? [] : [{ element, key }]),
      ])
    },
    [],
  )
  const [position, setPosition] = useState({ line: 1, column: 1 })
  const changeDocument = useEffectEvent(onChange)
  useImperativeHandle(
    editorRef,
    () => ({ focus: () => viewRef.current?.focus() }),
    [],
  )

  useEffect(() => {
    if (!container.current) return
    const parseJson = jsonParseLinter()
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          theme,
          json(),
          syntaxHighlighting(highlighting),
          history(),
          drawSelection(),
          indentUnit.of('  '),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          editable.of(EditorState.readOnly.of(false)),
          secrets.of([]),
          EditorView.contentAttributes.of({
            'aria-label': label,
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          }),
          keymap.of([
            // 放行下一次 Tab，同时避免 Escape 冒泡关闭设置弹窗。
            {
              key: 'Escape',
              run: (editor) => {
                editor.setTabFocusMode(2000)
                return true
              },
              stopPropagation: true,
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            { ...indentWithTab, stopPropagation: true },
          ]),
          linter((editor) =>
            parseJson(editor).map((diagnostic) => ({
              ...diagnostic,
              message: 'JSON 语法错误，请检查逗号、引号或括号。',
            })),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeDocument(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              const line = update.state.doc.lineAt(
                update.state.selection.main.head,
              )
              setPosition({
                line: line.number,
                column: update.state.selection.main.head - line.from + 1,
              })
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    if (autoFocus) view.focus()
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [editable, secrets, label, describedBy, autoFocus])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: secrets.reconfigure(
        readSecret && secretKeys
          ? secretWidgets(secretKeys, changeSecretElement)
          : [],
      ),
    })
  }, [secrets, secretKeys, readSecret, changeSecretElement])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: isolateHistory.of('full'),
      })
  }, [value])
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(Boolean(isDisabled)),
        EditorView.editable.of(!isDisabled),
        EditorView.contentAttributes.of({
          'aria-readonly': String(Boolean(isDisabled)),
        }),
      ]),
    })
  }, [editable, isDisabled])

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-field bg-default ${compact ? '[--mcp-json-editor-height:10rem]' : '[--mcp-json-editor-height:clamp(14rem,42vh,22rem)]'}`}
    >
      <div ref={container} className="min-w-0" />
      {readSecret &&
        secretElements.map(({ element, key }) =>
          createPortal(
            <McpSecretValue
              secretKey={key}
              readSecret={readSecret}
              isDisabled={isDisabled}
            />,
            element,
          ),
        )}
      <div className="flex items-center justify-between gap-3 border-t border-divider/50 px-3 py-1.5 text-[11px] text-muted">
        <span title="Tab 缩进 · Shift Tab 反缩进 · Esc 后 Tab 离开编辑区">
          JSON · 2 空格
        </span>
        <span aria-label="光标位置">
          第 {position.line} 行，第 {position.column} 列
        </span>
      </div>
    </div>
  )
}
