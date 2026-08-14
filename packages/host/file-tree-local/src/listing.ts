/**
 * Filesystem-listing helpers shared by the file-tree backend: fully-qualified
 * path fencing, the bounded name-sorted insertion window, and abort-racing.
 * @module
 */
import { posix, win32 } from 'node:path'

/** One streamed listing candidate: the dirent facts a row needs, nothing else retained. */
export interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
  /** Dirent says directory (no probe needed). */
  isDirectory: boolean
  /** Dirent says symlink (the final kind needs a stat probe). */
  isSymbolicLink: boolean
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting
 * the name-largest candidate when the window exceeds `keep`. Memory over an
 * arbitrarily large level stays O(keep) regardless of how many children the
 * directory holds.
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // Full window, name at or beyond the tail: one comparison rejects, so an
  // oversized level costs O(1) per candidate past the head.
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true
  // Binary insertion keeps a retained candidate at O(log keep) comparisons.
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation keeps
 * running against a handle the caller then closes; its late settlement is
 * swallowed here so an abandoned read cannot surface as an unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
export function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Escape literal text for RegExp embedding. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile a watcher-ignore glob into a RegExp over the slash-normalized
 * absolute path. Supported grammar: `/`-separated segments where `*` matches
 * within a segment and `**` matches zero or more full segments. A pattern
 * without a trailing `/**` still matches everything below the named path, so
 * a directory pattern ignores its whole subtree.
 *
 * Chokidar 5's own string matcher compares patterns by exact equality (its
 * bundled anymatch has no glob support), so these are compiled here and
 * handed to the watcher as a function.
 * @param glob - ignore pattern.
 * @returns the compiled matcher.
 */
export function globToRegExp(glob: string): RegExp {
  const segments = glob.split('/')
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    if (segment === '**') {
      // Zero or more whole segments. Each position owns its own separators:
      // leading, each matched segment carries its trailing slash; mid, the
      // token both opens and closes with a slash (zero matches still consume
      // the separator before the next literal); trailing, each matched
      // segment carries its leading slash.
      if (i === 0) parts.push('(?:[^/]+/)*')
      else if (i === segments.length - 1) parts.push('(?:/[^/]+)*')
      else parts.push('(?:/[^/]+)*/')
      continue
    }
    const literal = segment.split('*').map(escapeRegExp).join('[^/]*') + '(?=/|$)'
    // A globstar already consumed the separator between itself and this
    // literal; any other previous segment needs an explicit one.
    parts.push((i > 0 && segments[i - 1] !== '**' ? '/' : '') + literal)
  }
  const suffix = glob.endsWith('/**') ? '' : '(?:$|/.*)'
  return new RegExp(`(?:^|/)${parts.join('')}${suffix}`)
}

/** Message text of an unknown thrown value. */
export function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}
