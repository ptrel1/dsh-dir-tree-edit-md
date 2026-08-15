/**
 * Local-filesystem backend of the file-tree seam: registers `ctx.fileTree` with
 * one-level directory listing (files and directories), per-file git status read
 * through `ctx.subprocess`, and a Chokidar watcher that emits `filetree/change`
 * so the client can refresh without polling. Nothing renders on the host
 * display; this backend serves remote clients exactly like the browse backend
 * of the directory-picker seam does.
 * @module @deepseek-ai/dsh-host-file-tree-local
 */

import { open, opendir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import chokidar from 'chokidar'
import z from '@deepseek-ai/schemastery'
import { FileTree, FileTreeError } from '@deepseek-ai/dsh-host-file-tree'
import type { FileTreeEntry, FileTreeListing, FileTreeGitStatus, FileTreeReadResult, FileTreeSearchResult } from '@deepseek-ai/dsh-host-file-tree'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { aggregateDirStatus, findGitRoot, parseGitStatus } from './git.ts'
import {
  asError, boundedInsert, fullyQualified, globToRegExp, messageOf, nameMatches, pathIgnored, raceAbort,
} from './listing.ts'
import type { ListingCandidate } from './listing.ts'
import { decodeText, langFromPath, sniffBinary } from './read.ts'

/** Normalize a path to forward-slash separators, matching git's status output. */
function toSlash(path: string): string {
  return path.split(sep).join('/')
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer, and forcing one needs a filesystem torn down mid-request. */
/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level. */
  maxEntries: number
  /** Subprocess terminate-escalation grace period for the git-status spawn. */
  graceMs: number
  /** Byte cap on the complete `git status` stdout; overflow degrades to no coloring. */
  gitStatusMaxBytes: number
  /**
   * Include `--ignored` in the git-status scan. Off by default: enumerating
   * every ignored directory makes `git status` take minutes on a monorepo
   * (measured >5 min versus 0.06 s without it here); opt in for small repos.
   */
  gitStatusIncludeIgnored: boolean
  /**
   * Deadline for one git-status read; on expiry the spawn is terminated and
   * the listing degrades to no coloring instead of stalling forever.
   */
  gitStatusTimeoutMs: number
  /** Watch via polling (for network mounts that deliver no native fs events). */
  usePolling: boolean
  /** Polling interval in milliseconds, used only when {@link Config.usePolling} is true. */
  watchPollIntervalMs: number
  /**
   * Glob patterns the watcher skips (`*` within a segment, `**` across
   * segments; a directory pattern ignores its whole subtree), tested against
   * the slash-normalized absolute path. Defaults exclude `node_modules`,
   * `.git`, and `.pnpm-store`: watching a dependency store costs one handle
   * and event path per directory for nothing anyone wants a live signal for,
   * and a content-addressed store dwarfs the source tree many times over.
   */
  watchIgnored: string[]
  /**
   * Maximum directory depth below each listed root to arm watchers on;
   * undefined (default) arms every level.
   */
  watchDepth: number | undefined
  /** Complete-result bound of one name search. */
  searchMaxMatches: number
  /** Deadline for one name search; on expiry the search settles with the matches collected so far. */
  searchTimeoutMs: number
  /** Byte cap on one text-file read for the editor surface; larger files return a `truncated` prefix. */
  readMaxBytes: number
}

/**
 * The `ctx.fileTree` local implementation (one watcher per listed root, closed
 * at disposal).
 */
export default class LocalFileTree extends FileTree {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
    graceMs: z.natural().default(5000),
    gitStatusMaxBytes: z.natural().default(8 * 1024 * 1024),
    gitStatusIncludeIgnored: z.boolean().default(false),
    gitStatusTimeoutMs: z.natural().min(1).default(8000),
    usePolling: z.boolean().default(false),
    watchPollIntervalMs: z.natural().min(1).default(500),
    watchIgnored: z.array(z.string()).default(['**/node_modules/**', '**/.git/**', '**/.pnpm-store/**']),
    watchDepth: z.union([z.number().step(1).min(1), z.const(undefined)]),
    searchMaxMatches: z.natural().min(1).default(200),
    searchTimeoutMs: z.natural().min(1).default(10_000),
    readMaxBytes: z.natural().min(1).default(512 * 1024),
  })

  /** Live watchers by absolute root; closed and dropped on plugin disposal. */
  private readonly watchers = new Map<string, ReturnType<typeof chokidar.watch>>()

  /** In-flight git-status reads by repo root; one spawn serves every concurrent lister of that repo. */
  private readonly statusInflight = new Map<string, Promise<{
    root: string
    byRelPath: ReadonlyMap<string, FileTreeGitStatus>
    byDirPath: ReadonlyMap<string, FileTreeGitStatus>
  }>>()

  /** Compiled watcher-ignore patterns (chokidar 5 matches strings by exact equality, not glob). */
  private readonly ignoreMatchers: RegExp[]

  /** True when the watcher should skip `path` (backslash-form Windows paths included). */
  private isIgnored(path: string): boolean {
    return pathIgnored(path, this.ignoreMatchers)
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.ignoreMatchers = config.watchIgnored.map(globToRegExp)
    ctx.effect(() => () => {
      for (const watcher of this.watchers.values()) void watcher.close()
      this.watchers.clear()
    }, 'file-tree watcher teardown')
  }

  /**
   * List one directory level with per-file git status.
   * @param path - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the level's children (name-sorted) and its truncation flag.
   * @throws {FileTreeError} `tree-unreadable` when the path is not fully qualified or cannot be listed.
   */
  async listDir(path: string, signal?: AbortSignal): Promise<FileTreeListing> {
    if (!fullyQualified(path)) {
      throw new FileTreeError('tree-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    this.watchRoot(target)
    const { window, evicted } = await this.streamLevel(target, signal)
    const gitStatus = await this.readGitStatus(target, signal)
    const entries: FileTreeEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      signal?.throwIfAborted()
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      const row = await this.resolveEntry(target, candidate, gitStatus, signal)
      if (row === null) continue
      entries.push(row)
    }
    return { path: target, entries, truncated }
  }

  /**
   * Search file and directory names under a root (case-insensitive substring).
   * @param root - absolute directory to search (a session's workspace root).
   * @param query - trimmed non-empty substring matched against entry names.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns flat matched entries with per-row git status; `truncated` reports a cap or deadline cut.
   * @throws {FileTreeError} `tree-unreadable` when the root is not fully qualified or cannot be searched.
   */
  async search(root: string, query: string, signal?: AbortSignal): Promise<FileTreeSearchResult> {
    if (!fullyQualified(root)) {
      throw new FileTreeError('tree-unreadable', root, `cannot search "${root}": not a fully qualified path`)
    }
    const target = resolve(root)
    const needle = query.trim().toLowerCase()
    if (needle === '') return { path: target, matches: [], truncated: false }
    this.watchRoot(target)
    // Self-imposed deadline: the wire carrier's 30 s unary timeout is a
    // backstop, not a UX; on expiry the search settles with what it collected
    // rather than stalling (same doctrine as the git-status deadline).
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort() }, this.config.searchTimeoutMs)
    const lifetime = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    const matches: FileTreeEntry[] = []
    let truncated = false
    try {
      // One git scan per settled search; the shared `lifetime` also bounds the
      // git wait (runGitStatus degrades to no coloring on abort instead of rejecting).
      const gitStatus = await this.readGitStatus(target, lifetime)
      await this.searchLevel(target, '', needle, gitStatus, lifetime, (entry) => {
        if (matches.length === this.config.searchMaxMatches) {
          truncated = true
          return false
        }
        matches.push(entry)
        return true
      })
    } catch (error: unknown) {
      signal?.throwIfAborted()
      if (deadline.signal.aborted) truncated = true
      else throw new FileTreeError('tree-unreadable', target, `cannot search ${target}: ${messageOf(error)}`)
    } finally {
      clearTimeout(timer)
    }
    return { path: target, matches, truncated }
  }

  /**
   * Read one text file for the editor surface (the file-tree edit-marker panel).
   * @param path - absolute file to read.
   * @param signal - caller lifetime; abort stops the read and rejects with the abort reason.
   * @returns the decoded prefix and a syntax-highlighting language hint.
   * @throws {FileTreeError} `not-a-text-file` for binary content, `tree-unreadable` otherwise.
   */
  async readFile(path: string, signal?: AbortSignal): Promise<FileTreeReadResult> {
    if (!fullyQualified(path)) {
      throw new FileTreeError('tree-unreadable', path, `cannot read "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    let handle: Awaited<ReturnType<typeof open>>
    try {
      const opening = open(target, 'r')
      handle = await raceAbort(opening, signal).catch((error: unknown) => {
        // If the abort won the race, `open` can still settle later with a
        // FileHandle nobody owns — close it so the descriptor is never
        // abandoned to GC (DEP0137), mirroring the opendir cleanup below.
        void opening.then(fh => fh.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
    } catch (error: unknown) {
      signal?.throwIfAborted()
      throw new FileTreeError('tree-unreadable', target, `cannot read ${target}: ${messageOf(error)}`)
    }
    try {
      const info = await raceAbort(handle.stat(), signal)
      if (info.isDirectory()) {
        throw new FileTreeError('tree-unreadable', target, `cannot read ${target}: it is a directory`)
      }
      // A bounded prefix: the editor renders this much, and `truncated` says the
      // file continues. Reading a fixed cap (not the whole file) keeps a huge
      // file from consuming the backend's memory.
      const length = Math.min(info.size, this.config.readMaxBytes)
      const buffer = Buffer.allocUnsafe(length)
      let received = 0
      while (received < length) {
        const { bytesRead } = await raceAbort(handle.read(buffer, received, length - received, received), signal)
        if (bytesRead === 0) break
        received += bytesRead
      }
      const prefix = received < buffer.length ? buffer.subarray(0, received) : buffer
      if (sniffBinary(prefix)) {
        throw new FileTreeError('not-a-text-file', target, `cannot read ${target}: binary content`)
      }
      const language = langFromPath(target)
      return {
        path: target,
        text: decodeText(prefix),
        truncated: info.size > this.config.readMaxBytes,
        ...(language === undefined ? {} : { language }),
      }
    } catch (error: unknown) {
      if (error instanceof FileTreeError) throw error
      signal?.throwIfAborted()
      throw new FileTreeError('tree-unreadable', target, `cannot read ${target}: ${messageOf(error)}`)
    } finally {
      const closing = handle.close()
      /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
      if (signal?.aborted) closing.catch(swallowCloseFailure)
      else await closing
    }
  }

  /**
   * Walk one directory of the search recursion, emitting matches. Returns
   * false once `onMatch` declines (the whole walk stops immediately — every
   * caller checks the nested result), true to keep walking siblings.
   * Unreadable subdirectories mid-walk are skipped silently (best-effort
   * search); only the root level's failure propagates, and an abort always
   * propagates so the caller sees it.
   */
  private async searchLevel(
    dir: string,
    relPrefix: string,
    needle: string,
    gitStatus: {
      root: string | undefined
      byRelPath: ReadonlyMap<string, FileTreeGitStatus>
      byDirPath: ReadonlyMap<string, FileTreeGitStatus>
    },
    signal: AbortSignal,
    onMatch: (entry: FileTreeEntry) => boolean,
  ): Promise<boolean> {
    let level: Awaited<ReturnType<typeof opendir>>
    try {
      const opening = opendir(dir)
      level = await raceAbort(opening, signal).catch((error: unknown) => {
        void opening.then(d => d.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
    } catch (error: unknown) {
      if (signal.aborted) throw asError(signal.reason)
      if (relPrefix === '') throw error
      return true
    }
    try {
      for (;;) {
        const dirent = await raceAbort(level.read(), signal)
        if (dirent === null) break
        const candidate: ListingCandidate = {
          name: dirent.name,
          isDirectory: dirent.isDirectory(),
          isSymbolicLink: dirent.isSymbolicLink(),
        }
        const rel = relPrefix === '' ? candidate.name : `${relPrefix}/${candidate.name}`
        if (this.isIgnored(rel)) continue
        if (!nameMatches(candidate.name, needle)) {
          // Descend real directories only; symlinked directories are never
          // followed (a node_modules junction would loop or blow up the walk).
          if (candidate.isDirectory && !candidate.isSymbolicLink) {
            if (!await this.searchLevel(join(dir, candidate.name), rel, needle, gitStatus, signal, onMatch)) return false
          }
          continue
        }
        const entry = await this.resolveEntry(dir, candidate, gitStatus, signal)
        if (entry === null) continue
        if (!onMatch(entry)) return false
        // A matching directory is both a result and a place to keep looking.
        if (entry.kind === 'directory' && !candidate.isSymbolicLink) {
          if (!await this.searchLevel(join(dir, candidate.name), rel, needle, gitStatus, signal, onMatch)) return false
        }
      }
    } finally {
      const closing = level.close()
      /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
      if (signal.aborted) {
        closing.catch(swallowCloseFailure)
      } else {
        await closing
      }
    }
    return true
  }

  /** Stream one level into a bounded name-sorted window, plus the eviction flag. */
  private async streamLevel(
    target: string,
    signal: AbortSignal | undefined,
  ): Promise<{ window: ListingCandidate[]; evicted: boolean }> {
    const keep = this.config.maxEntries + 1
    const window: ListingCandidate[] = []
    let evicted = false
    try {
      const opening = opendir(target)
      const level = await raceAbort(opening, signal).catch((error: unknown) => {
        void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
      try {
        for (;;) {
          const dirent = await raceAbort(level.read(), signal)
          if (dirent === null) break
          const candidate = {
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            isSymbolicLink: dirent.isSymbolicLink(),
          }
          if (boundedInsert(window, candidate, keep)) evicted = true
        }
      } finally {
        const closing = level.close()
        /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
        if (signal?.aborted) {
          closing.catch(swallowCloseFailure)
        } else {
          await closing
        }
      }
    } catch (error: unknown) {
      signal?.throwIfAborted()
      throw new FileTreeError('tree-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
    return { window, evicted }
  }

  /** Resolve one candidate into a tree row, probing symlinks and attaching git status. */
  private async resolveEntry(
    parent: string,
    candidate: ListingCandidate,
    gitStatus: {
      root: string | undefined
      byRelPath: ReadonlyMap<string, FileTreeGitStatus>
      byDirPath: ReadonlyMap<string, FileTreeGitStatus>
    },
    signal: AbortSignal | undefined,
  ): Promise<FileTreeEntry | null> {
    const path = join(parent, candidate.name)
    let isDirectory = candidate.isDirectory
    if (!isDirectory && candidate.isSymbolicLink) {
      try {
        isDirectory = (await raceAbort(stat(path), signal)).isDirectory()
      } catch {
        /* v8 ignore next 2 -- an abort landing mid-probe needs a stalled stat; the settled broken-link arm is the ordinary skip. */
        if (signal?.aborted) throw asError(signal.reason)
        return null
      }
    }
    const kind = isDirectory ? 'directory' : 'file'
    const entry: FileTreeEntry = { name: candidate.name, path, kind, hidden: candidate.name.startsWith('.') }
    if (gitStatus.root !== undefined) {
      // Files report their own status; directories aggregate the highest-ranked
      // status of anything below them, so a change deep in a tree still inks
      // every enclosing directory row.
      const status = (kind === 'file' ? gitStatus.byRelPath : gitStatus.byDirPath)
        .get(toSlash(relative(gitStatus.root, path)))
      if (status !== undefined) entry.gitStatus = status
    }
    return entry
  }

  /** Read the working-tree status of the repo containing `listedPath`, or empty maps. */
  private async readGitStatus(
    listedPath: string,
    signal?: AbortSignal,
  ): Promise<{
    root: string | undefined
    byRelPath: ReadonlyMap<string, FileTreeGitStatus>
    byDirPath: ReadonlyMap<string, FileTreeGitStatus>
  }> {
    const root = await findGitRoot(listedPath)
    if (root === undefined) return { root: undefined, byRelPath: new Map(), byDirPath: new Map() }
    // One status scan per repo root: a change-event storm re-lists every
    // expanded level at once, and without single-flight each re-list would
    // stack its own multi-second spawn on the same repo.
    const prior = this.statusInflight.get(root)
    if (prior !== undefined) return prior
    const run = this.runGitStatus(root, signal).finally(() => {
      this.statusInflight.delete(root)
    })
    this.statusInflight.set(root, run)
    return run
  }

  /** Run one git-status spawn, bounded by the configured deadline; any failure degrades to no coloring. */
  private async runGitStatus(
    root: string,
    signal?: AbortSignal,
  ): Promise<{
    root: string
    byRelPath: ReadonlyMap<string, FileTreeGitStatus>
    byDirPath: ReadonlyMap<string, FileTreeGitStatus>
  }> {
    const argv = ['git', '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all']
    if (this.config.gitStatusIncludeIgnored) argv.push('--ignored')
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort() }, this.config.gitStatusTimeoutMs)
    // The deadline terminates the real child through the spawn signal and
    // rejects this await directly; the caller's signal only passes through.
    const lifetime = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    try {
      const handle: SubprocessHandle = this.ctx.subprocess.spawn({
        argv,
        cwd: root,
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.gitStatusMaxBytes }, stderr: { maxBytes: 4096 } },
        graceMs: this.config.graceMs,
        signal: lifetime,
      } satisfies SubprocessSpawnSpec)
      const outcome: SubprocessOutcome = await raceAbort(handle.done, deadline.signal)
      // Exit 0 means a repository was scanned; anything else (not a repo, git
      // missing) degrades to no coloring rather than failing the listing.
      if (outcome.exitCode !== 0) return { root, byRelPath: new Map(), byDirPath: new Map() }
      const stdout = handle.collected.stdout?.readFrom(0)
      if (stdout === undefined || stdout.lossy) return { root, byRelPath: new Map(), byDirPath: new Map() }
      const byRelPath = parseGitStatus(stdout.text)
      return { root, byRelPath, byDirPath: aggregateDirStatus(byRelPath) }
    } catch {
      // Spawn failure, deadline, or caller abort: the listing still settles.
      return { root, byRelPath: new Map(), byDirPath: new Map() }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Start watching `root` once, relaying every filesystem event as a `filetree/change` emit. */
  private watchRoot(root: string): void {
    if (this.watchers.has(root)) return
    const watcher = chokidar.watch(root, {
      persistent: true,
      ignoreInitial: true,
      // Never descend symlinks/junctions: a pnpm workspace's node_modules are
      // junctions into the virtual store, and following one means arming a
      // watcher per store directory. The listing probes symlinks itself.
      followSymlinks: false,
      // Never arm watchers inside dependency stores or VCS internals: chokidar
      // holds one handle and event path per directory, and a monorepo's
      // node_modules alone dwarfs the source tree many times over. String
      // globs are exact-equality no-ops in chokidar 5, so the compiled
      // matchers above are passed as a function instead.
      ignored: (path: string) => this.isIgnored(path),
      ...(this.config.watchDepth === undefined ? {} : { depth: this.config.watchDepth }),
      usePolling: this.config.usePolling,
      interval: this.config.watchPollIntervalMs,
      awaitWriteFinish: this.config.usePolling
        ? false
        : { stabilityThreshold: 200, pollInterval: 100 },
    })
    watcher.on('all', (_eventName, path) => {
      this.ctx.emit('filetree/change', root, [path])
    })
    this.watchers.set(root, watcher)
  }
}
