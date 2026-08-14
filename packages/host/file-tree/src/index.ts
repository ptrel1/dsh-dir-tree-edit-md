/**
 * Service Definition for the `ctx.fileTree` capability seam: how the web-GUI
 * host lists one workspace directory level for an in-app file tree. A backend
 * lists direct children (files and directories) with per-row git status — a
 * file reports its own, a directory aggregates the highest-ranked status of
 * its descendants — and reports filesystem changes on the `filetree/change`
 * event so a consumer can refresh its expanded view without polling. Unlike
 * `directory-picker`, whose browse backend returns directories only, this
 * seam returns files too because the file tree shows them; neither seam reads
 * file contents.
 * @module @deepseek-ai/dsh-host-file-tree
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { FileTreeErrorCode, FileTreeListing, FileTreeSearchResult } from './types.ts'

export type {
  FileTreeEntry,
  FileTreeEntryKind,
  FileTreeErrorCode,
  FileTreeGitStatus,
  FileTreeListing,
  FileTreeSearchResult,
} from './types.ts'

/** Typed failure thrown by the listing primitive so consumers can map business codes without string matching. */
export class FileTreeError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: FileTreeErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'FileTreeError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileTree: FileTree
  }
}

/**
 * Abstract file-tree service. Subclass, implement `listDir`, and load the
 * subclass as a plugin — it registers as `ctx.fileTree` (one implementation
 * per context; loading a second throws, cordis' standard duplicate-service
 * behavior).
 */
export abstract class FileTree extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileTree')
  }

  /**
   * List one directory level, including files and per-row git status.
   * @param path - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the level's children; backends bound the complete result and report `truncated`.
   * @throws {FileTreeError} `tree-unreadable` when the path is not fully qualified or cannot be listed.
   */
  abstract listDir(path: string, signal?: AbortSignal): Promise<FileTreeListing>

  /**
   * Search file and directory names under a root (case-insensitive substring).
   * @param root - absolute directory to search (a session's workspace root).
   * @param query - trimmed non-empty substring matched against entry names.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns flat matched entries (no ancestor rows); backends bound the scan and report `truncated`.
   * @throws {FileTreeError} `tree-unreadable` when the root is not fully qualified or cannot be searched.
   */
  abstract search(root: string, query: string, signal?: AbortSignal): Promise<FileTreeSearchResult>
}

export default FileTree
