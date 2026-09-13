import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { SAVED_SECRET } from '../utils/secret-editor.ts'

type SecretElementChange = (element: HTMLElement, key?: string) => void

/** CodeMirror 只提供挂载位置，交互由父 React 树渲染，保留弹窗的焦点上下文。 */
class SecretWidget extends WidgetType {
  readonly key: string
  readonly onChange: SecretElementChange
  constructor(key: string, onChange: SecretElementChange) {
    super()
    this.key = key
    this.onChange = onChange
  }
  eq(other: SecretWidget) {
    return this.key === other.key && this.onChange === other.onChange
  }
  toDOM() {
    const element = document.createElement('span')
    element.contentEditable = 'false'
    this.onChange(element, this.key)
    return element
  }
  destroy(element: HTMLElement) {
    this.onChange(element)
  }
}

/** 只替换顶层已知键的未修改遮罩；其它文本照常编辑和校验。 */
export function secretWidgets(
  keys: readonly string[],
  onChange: SecretElementChange,
) {
  const decorate = (view: EditorView) => {
    const ranges: Range<Decoration>[] = []
    for (const property of syntaxTree(view.state)
      .topNode.getChild('Object')
      ?.getChildren('Property') ?? []) {
      const name = property.getChild('PropertyName'),
        value = property.getChild('String')
      if (
        !name ||
        !value ||
        view.state.sliceDoc(value.from, value.to) !==
          JSON.stringify(SAVED_SECRET)
      )
        continue
      let key: unknown
      try {
        key = JSON.parse(view.state.sliceDoc(name.from, name.to))
      } catch {
        continue
      }
      if (typeof key === 'string' && keys.includes(key))
        ranges.push(
          Decoration.replace({ widget: new SecretWidget(key, onChange) }).range(
            value.from,
            value.to,
          ),
        )
    }
    return Decoration.set(ranges)
  }
  return ViewPlugin.fromClass(
    class {
      decorations
      constructor(view: EditorView) {
        this.decorations = decorate(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged)
          this.decorations = decorate(update.view)
      }
    },
    { decorations: (value) => value.decorations },
  )
}
