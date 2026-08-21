/**
 * Edit-marker client helpers: a text-file gate for the context menu, basename
 * splitting, and DOM-selection → line/column mapping for the editor surface.
 * The language hints themselves come from the Host (`readFile`), so the client
 * only needs to know which names plausibly hold text.
 * @module
 */

/** Extensions the context menu offers the "edit marker" action for (a UX gate; the Host's binary sniff is authoritative). */
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'markdown', 'mdx', 'rst', 'text', 'conf', 'ini', 'cfg', 'toml', 'yaml', 'yml',
  'json', 'jsonc', 'json5', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'sass', 'csv', 'tsv',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cc',
  'hpp', 'cs', 'kt', 'kts', 'swift', 'php', 'sql', 'lua', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'cmd', 'dockerfile', 'makefile', 'env', 'gitignore', 'gitattributes', 'lock', 'graphql', 'gql',
  'vue', 'svelte', 'astro', 'tex', 'diff', 'patch',
])

/** File basenames (no extension) that are text. */
const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'jenkinsfile', 'vagrantfile', 'procfile',
  'gitignore', 'gitattributes', 'license', 'readme', 'changelog', 'authors', 'notice',
])

/**
 * A cheap gate for the context menu's "edit marker" row: whether a file name
 * looks like text. The Host's binary sniff remains authoritative — a false
 * positive here only means the editor opens and reports "not a text file".
 * @param name - the file basename.
 * @returns whether the name suggests editable text.
 */
export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  // A hidden file (leading dot) carries its text identity after the dot, so
  // `.gitignore` matches the `gitignore` basename and `.env` the `env` extension.
  const stem = lower.startsWith('.') ? lower.slice(1) : lower
  if (TEXT_BASENAMES.has(stem)) return true
  const dot = stem.lastIndexOf('.')
  if (dot <= 0 || dot === stem.length - 1) return false
  return TEXT_EXTENSIONS.has(stem.slice(dot + 1))
}

/**
 * The trailing path segment (both separator conventions).
 * @param path - the file path to split.
 * @returns the trailing path segment, or the whole input when it has no separator.
 */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A collapsed DOM selection mapped to 0-based line/column coordinates (columns are code units within a line). */
export interface SelectionRange {
  /** 0-based first line. */
  startLine: number
  /** 0-based column of the selection start within its line. */
  startColumn: number
  /** 0-based last line (inclusive). */
  endLine: number
  /** 0-based column of the selection end within its line (exclusive). */
  endColumn: number
}

/** The nearest ancestor (or self) carrying `data-line`. */
function enclosingLine(node: Node | null): HTMLElement | null {
  for (let cursor: Node | null = node; cursor !== null; cursor = cursor.parentNode) {
    if (cursor instanceof HTMLElement && cursor.dataset.line !== undefined) return cursor
  }
  return null
}

/** Character offset of a DOM point inside one line, measured over its content text. */
function offsetInLine(line: HTMLElement, node: Node, offset: number): number {
  const content = line.querySelector<HTMLElement>('[data-content]')
  if (content === null) return 0
  const range = document.createRange()
  range.setStart(content, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

/**
 * Map the current window selection to line/column coordinates within `root`,
 * or `null` when the selection is empty or outside the editor. Each line's
 * `data-line` attribute names its 1-based number; columns are 0-based code-unit
 * offsets measured over the rendered text (token and marker spans are inline,
 * so rendered text equals source text).
 * @param root - the editor body element.
 * @param lines - the source lines (for reconstructing the selected text later).
 * @returns the mapped range, or null.
 */
export function selectionRange(root: HTMLElement, lines: readonly string[]): (SelectionRange & { text: string }) | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const startLine = enclosingLine(range.startContainer)
  const endLine = enclosingLine(range.endContainer)
  if (startLine === null || endLine === null) return null
  if (!root.contains(startLine) || !root.contains(endLine)) return null
  const start = Number(startLine.dataset.line) - 1
  const end = Number(endLine.dataset.line) - 1
  const startColumn = offsetInLine(startLine, range.startContainer, range.startOffset)
  const endColumn = offsetInLine(endLine, range.endContainer, range.endOffset)
  // A forward drag can place the anchor after the focus; normalize so start <= end.
  let firstLine = start
  let firstColumn = startColumn
  let lastLine = end
  let lastColumn = endColumn
  if (firstLine > lastLine || (firstLine === lastLine && firstColumn > lastColumn)) {
    firstLine = end
    firstColumn = endColumn
    lastLine = start
    lastColumn = startColumn
  }
  if (firstLine === lastLine && firstColumn === lastColumn) return null
  return {
    startLine: firstLine, startColumn: firstColumn, endLine: lastLine, endColumn: lastColumn,
    text: selectedText(lines, firstLine, firstColumn, lastLine, lastColumn),
  }
}

/** Reconstruct the selected source text from the line array (DOM text drops inter-line newlines, so this is authoritative). */
function selectedText(
  lines: readonly string[],
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): string {
  if (startLine === endLine) return lines[startLine]?.slice(startColumn, endColumn) ?? ''
  const parts: string[] = []
  const first = lines[startLine]
  if (first !== undefined) parts.push(first.slice(startColumn))
  for (let i = startLine + 1; i < endLine; i++) parts.push(lines[i] ?? '')
  const last = lines[endLine]
  if (last !== undefined) parts.push(last.slice(0, endColumn))
  return parts.join('\n')
}
