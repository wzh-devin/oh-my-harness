import type { ElementType } from 'react'
import {
  AtomIcon,
  BracesIcon,
  CodeXmlIcon,
  DatabaseIcon,
  FileTextIcon,
  PaletteIcon,
  SquareTerminalIcon,
} from 'lucide-react'

const FILE_TYPE_ICONS: Readonly<Partial<Record<string, ElementType>>> = {
  BASH: SquareTerminalIcon,
  CSS: PaletteIcon,
  HTML: CodeXmlIcon,
  HTM: CodeXmlIcon,
  JSON: BracesIcon,
  JSONC: BracesIcon,
  JSONL: BracesIcon,
  JSX: AtomIcon,
  LESS: PaletteIcon,
  MD: FileTextIcon,
  MDX: FileTextIcon,
  SCSS: PaletteIcon,
  SH: SquareTerminalIcon,
  SQL: DatabaseIcon,
  SVELTE: CodeXmlIcon,
  TOML: BracesIcon,
  TSX: AtomIcon,
  VUE: CodeXmlIcon,
  XML: CodeXmlIcon,
  YAML: BracesIcon,
  YML: BracesIcon,
  ZSH: SquareTerminalIcon,
}

/** 按扩展名渲染可辨识的文件类型图标。 */
export const FileReferenceIcon = ({ label }: { label: string }) => {
  const FileIcon = FILE_TYPE_ICONS[label]
  if (FileIcon) {
    return <FileIcon aria-hidden="true" className="size-4 shrink-0" />
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-accent text-[8px] leading-none font-bold text-accent-foreground"
    >
      {label.slice(0, 2)}
    </span>
  )
}
