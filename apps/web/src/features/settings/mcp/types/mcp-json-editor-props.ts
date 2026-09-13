import type { RefObject } from 'react'

export interface McpJsonCodeEditorProps {
  secretKeys?: readonly string[]
  readSecret?(key: string, signal: AbortSignal): Promise<{ value: string }>
  value: string
  label: string
  describedBy?: string
  compact?: boolean
  autoFocus?: boolean
  isDisabled: boolean
  onChange(value: string): void
  editorRef?: RefObject<{ focus(): void } | null>
}
