/**
 * Text-file read helpers for the file-tree backend: a path-derived syntax
 * language hint, a NUL-byte binary sniff, and BOM-stripped UTF-8 decoding.
 * The language hints mirror the client highlighter's grammar aliases
 * (`shiki` ids like `ts`, `py`, `md`), so an editor passes the returned hint
 * straight into the tokenizer.
 * @module
 */

/** UTF-8 byte-order mark, stripped before decoding so the first line is not prefixed. */
const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF])

/**
 * One extension → shiki language id (the client's grammar aliases). A path
 * with no grammar still reads as plain text; only a binary sniff rejects a
 * read. Kept in sync with the client's own table for the context-menu gate.
 */
const EXTENSION_LANGS = new Map<string, string>([
  ['ts', 'ts'], ['tsx', 'tsx'], ['js', 'js'], ['jsx', 'jsx'], ['mjs', 'js'], ['cjs', 'js'],
  ['json', 'json'], ['jsonc', 'json'],
  ['sh', 'bash'], ['bash', 'bash'], ['zsh', 'bash'],
  ['py', 'py'], ['rb', 'rb'], ['go', 'go'], ['rs', 'rs'], ['java', 'java'],
  ['c', 'c'], ['h', 'c'], ['cpp', 'cpp'], ['cc', 'cpp'], ['hpp', 'cpp'],
  ['cs', 'csharp'], ['kt', 'kotlin'], ['swift', 'swift'], ['php', 'php'],
  ['yaml', 'yaml'], ['yml', 'yaml'], ['toml', 'toml'], ['ini', 'ini'],
  ['md', 'md'], ['markdown', 'md'], ['mdx', 'mdx'],
  ['html', 'html'], ['htm', 'html'], ['css', 'css'], ['scss', 'scss'], ['less', 'less'],
  ['sql', 'sql'], ['xml', 'xml'], ['lua', 'lua'],
])

/**
 * Derive a shiki language id from a file path's extension. Unknown or missing
 * extensions yield `undefined` (the caller renders plain text — never an error).
 * @param path - the file path (absolute or basename).
 * @returns the language id, or `undefined` for an unknown/absent extension.
 */
export function langFromPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return undefined
  return EXTENSION_LANGS.get(base.slice(dot + 1).toLowerCase())
}

/**
 * True when the byte window carries a NUL — the classic binary-file signal
 * (UTF-8/ASCII text never contains one). Only the read prefix is sniffed, so a
 * file with binary data past the prefix still reads as text; the prefix is
 * what the editor renders anyway.
 * @param bytes - the read prefix.
 * @returns whether the prefix looks binary.
 */
export function sniffBinary(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/**
 * Decode a UTF-8 byte window into text, stripping a leading byte-order mark.
 * Invalid sequences decode to U+FFFD (replacement) rather than throwing — the
 * editor shows the file as best it can; only the NUL sniff gates reads.
 * @param bytes - the read prefix.
 * @returns the decoded text.
 */
export function decodeText(bytes: Uint8Array): string {
  const window = bytes.length >= UTF8_BOM.length && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]
    ? bytes.subarray(UTF8_BOM.length)
    : bytes
  return Buffer.from(window).toString('utf8')
}
