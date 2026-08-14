/**
 * Git working-tree helpers for the file-tree backend: porcelain=v1 -z parsing
 * folded into the seam's classic statuses, and `.git` ancestor discovery.
 * @module
 */
import { dirname, join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { FileTreeGitStatus } from '@deepseek-ai/dsh-host-file-tree'

/** Porcelain=v1 status characters, in reading order (space = unmodified). */
const PORCELAIN_CHARS = ' MADRCU?!'

/**
 * Fold one two-character porcelain=v1 status code into a classic status.
 * Untracked (`??`) and ignored (`!!`) are exact; deletion and addition win in
 * either position; every other non-space code (rename, conflict, modified)
 * folds to `modified`; an all-space code is unmodified and yields undefined.
 * @param code - two-character XY code.
 * @returns the folded status, or undefined for an unmodified path.
 */
export function statusForCode(code: string): FileTreeGitStatus | undefined {
  if (code === '??') return 'untracked'
  if (code === '!!') return 'ignored'
  if (code[0] === 'D' || code[1] === 'D') return 'deleted'
  if (code[0] === 'A' || code[1] === 'A' || code[0] === 'C' || code[1] === 'C') return 'added'
  if (code[0] !== ' ' || code[1] !== ' ') return 'modified'
  return undefined
}

/** True when the two characters are a porcelain=v1 status code pair. */
function isCode(x: string, y: string): boolean {
  return PORCELAIN_CHARS.includes(x) && PORCELAIN_CHARS.includes(y)
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` output (optionally
 * with `--ignored` records) into a repo-root-relative path → status map. A
 * rename/copy record's trailing secondary field (the destination path) keeps
 * the record's folded status, so both the old and the new path land in the map.
 * @param output - complete NUL-separated stdout.
 * @returns the parsed map; malformed fields are skipped.
 */
export function parseGitStatus(output: string): ReadonlyMap<string, FileTreeGitStatus> {
  const statuses = new Map<string, FileTreeGitStatus>()
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field === undefined) continue
    const x = field[0]
    const y = field[1]
    if (field.length < 3 || field[2] !== ' ' || x === undefined || y === undefined || !isCode(x, y)) continue
    const code = field.slice(0, 2)
    const status = statusForCode(code)
    if (status === undefined) continue
    const primary = field.slice(3)
    if (primary !== '') statuses.set(primary, status)
    if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
      const secondary = fields[++i]
      if (secondary !== undefined && secondary !== '') statuses.set(secondary, status)
    }
  }
  return statuses
}

/** Directory-aggregation rank of each classic status; a mixed directory keeps the highest. */
const DIR_STATUS_RANK: Readonly<Record<FileTreeGitStatus, number>> = {
  modified: 5,
  added: 4,
  deleted: 3,
  untracked: 2,
  ignored: 1,
}

/**
 * Derive one status per ancestor directory of every statused path, so a
 * directory row colors when anything below it — at any depth — has a status
 * (`git status --untracked-files=all` reports files only). A collapsed
 * directory record (`?? dir/`, or `!! dir/` under `--ignored`) colors the
 * directory itself. A directory holding mixed statuses keeps the
 * highest-ranked one.
 * @param byRelPath - repo-root-relative path → status map from {@link parseGitStatus}.
 * @returns repo-root-relative directory → aggregated status map.
 */
export function aggregateDirStatus(
  byRelPath: ReadonlyMap<string, FileTreeGitStatus>,
): ReadonlyMap<string, FileTreeGitStatus> {
  const byDir = new Map<string, FileTreeGitStatus>()
  const merge = (dir: string, status: FileTreeGitStatus): void => {
    const prior = byDir.get(dir)
    if (prior === undefined || DIR_STATUS_RANK[status] > DIR_STATUS_RANK[prior]) byDir.set(dir, status)
  }
  for (const [relPath, status] of byRelPath) {
    const normalized = relPath.replace(/\\/g, '/')
    if (normalized.endsWith('/')) merge(normalized.slice(0, -1), status)
    const parts = normalized.split('/')
    parts.pop() // the entry itself; only ancestors aggregate
    for (let i = parts.length; i >= 1; i--) {
      const dir = parts.slice(0, i).join('/')
      if (dir !== '' && dir !== '.') merge(dir, status)
    }
  }
  return byDir
}

/** True when a `.git` entry exists at `path` (a directory or a worktree/submodule pointer file). */
export async function entryExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The nearest ancestor of `start` that contains a `.git` entry, else undefined.
 * @param start - absolute directory to search upward from.
 * @param exists - existence probe; injectable for tests (defaults to the real stat probe).
 * @returns the git work-tree root, or undefined when none is found up to the filesystem root.
 */
export async function findGitRoot(
  start: string,
  exists: (path: string) => Promise<boolean> = entryExists,
): Promise<string | undefined> {
  let current = start
  for (;;) {
    if (await exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
