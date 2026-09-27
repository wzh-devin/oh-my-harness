export const MAX_HIGHLIGHT_BYTES = 256 * 1024

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: 'shellscript',
  cjs: 'javascript',
  css: 'css',
  cts: 'typescript',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsonl: 'jsonl',
  jsx: 'jsx',
  less: 'less',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript',
}

const UNSAFE_FILE_REFERENCE_PATTERN = /(?:^|\/)\.\.(?:\/|$)|[\0\r\n\t\\]/
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const GLOB_FILE_REFERENCE_PATTERN = /[*?[\]{}]/u

/** 按文件扩展名选择受控的 Shiki 语言，大文件和未知类型保持纯文本。 */
export const getFilePreviewLanguage = (path: string, size: number) => {
  if (size > MAX_HIGHLIGHT_BYTES) return undefined

  const dotIndex = path.lastIndexOf('.')
  if (dotIndex <= path.lastIndexOf('/') + 1) return undefined

  const extension = path.slice(dotIndex + 1).toLowerCase()
  return LANGUAGE_BY_EXTENSION[extension]
}

/** 将受控扩展名的安全相对路径识别为可打开的正文文件引用。 */
export const getWorkspaceFileReference = (value: string) => {
  const path = value.trim()
  if (
    !path ||
    path.startsWith('/') ||
    path.startsWith('~') ||
    URI_SCHEME_PATTERN.test(path) ||
    UNSAFE_FILE_REFERENCE_PATTERN.test(path) ||
    GLOB_FILE_REFERENCE_PATTERN.test(path) ||
    !getFilePreviewLanguage(path, 0)
  ) {
    return undefined
  }

  return {
    label: path.slice(path.lastIndexOf('.') + 1).toUpperCase(),
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
  }
}
