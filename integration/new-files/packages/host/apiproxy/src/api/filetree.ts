/**
 * filetree domain contract. Wire projection of the host-side file-tree
 * capability (@deepseek-ai/dsh-host-file-tree): one directory level with
 * per-row git status, plus a recursive name search. Method signatures are
 * the source of truth.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire-side entry kind, re-declared here so api/ stays browser-importable. */
export type FileTreeEntryKind = 'file' | 'directory'

/** Wire-side git status (the seam's classic set). */
export type FileTreeGitStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored'

/** One file-tree row: a direct child of the listed directory. */
export interface FileTreeEntry {
  /** Base name shown in a tree row. */
  name: string
  /** Absolute host path — clients never join path segments themselves. */
  path: string
  /** Whether the child is a file or a directory. */
  kind: FileTreeEntryKind
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
  /** Git status for the row: a file reports its own; a directory aggregates the highest-ranked
   *  status below it. Absent outside any git work tree. */
  gitStatus?: FileTreeGitStatus
}

/** One directory level as the backend reports it. */
export interface FileTreeListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Direct children (files and directories), name-sorted; the client owns directory-first grouping. */
  entries: FileTreeEntry[]
  /** True when the backend cut `entries` at its complete-result bound. */
  truncated: boolean
}

/** One file-name search result below a root: flat matched entries (no ancestor rows). */
export interface FileTreeSearchResult {
  /** Absolute search root. */
  path: string
  /** Matched files and directories, in walk order. */
  matches: FileTreeEntry[]
  /** True when the backend cut `matches` at its complete-result bound or deadline. */
  truncated: boolean
}

/** One text file read for the editor surface. */
export interface FileTreeReadResult {
  /** Absolute path of the read file. */
  path: string
  /** Decoded UTF-8 text (a prefix when `truncated`). */
  text: string
  /** True when the backend cut `text` at its complete-read bound. */
  truncated: boolean
  /** Syntax-highlighting language hint, or absent for plain text. */
  language?: string
}

/** One text-region edit marker's completion state. */
export type FileAnnotationStatus = 'pending' | 'done'

/** One user-marked text region plus the instruction the model should carry out there. */
export interface FileAnnotation {
  /** Client-generated stable identity. */
  id: string
  /** Absolute path of the marked file. */
  path: string
  /** 1-based first line of the marked region (inclusive). */
  startLine: number
  /** 1-based last line of the marked region (inclusive). */
  endLine: number
  /** 1-based column of the region start within its line (inclusive). */
  startColumn: number
  /** 1-based column of the region end within its line (exclusive). */
  endColumn: number
  /** The selected text snapshot at mark time. */
  text: string
  /** The user's instruction to the model for this region. */
  instruction: string
  /** Completion state: `pending` until the model edits the file, then `done`. */
  status: FileAnnotationStatus
}

/** File-tree unary methods. */
export interface FileTreeApi {
  /**
   * List one directory level with per-row git status. The caller supplies the
   * absolute directory (a session's workspace root). Unreadable or missing
   * targets fail with `tree-unreadable`; the carrier's request signal follows
   * the caller, stopping the backend's scan on disconnect or timeout.
   */
  list(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FileTreeListing>>

  /**
   * Search file and directory names under a root (case-insensitive substring).
   * The backend bounds the scan and reports `truncated`; unreadable roots fail
   * with `tree-unreadable`. The carrier's request signal follows the caller,
   * stopping the backend's scan on disconnect or timeout.
   */
  search(
    request: RpcRequest<{ path: string; query: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FileTreeSearchResult>>

  /**
   * Record a session's selected-file set (the file tree's multi-select). The
   * host logs a durable `file/selection` event so the selection reaches the
   * model's context; an absent selection service fails with
   * `file-tree-unavailable`.
   */
  select(
    request: RpcRequest<{ sessionId: SessionId; files: string[] }>,
  ): Promise<RpcResponse<{ selected: string[] }>>

  /**
   * Read one text file for the editor surface. Binary content fails with
   * `not-a-text-file`; unreadable targets fail with `tree-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's read
   * on disconnect or timeout.
   */
  read(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FileTreeReadResult>>

  /**
   * Record a session's complete edit-marker set. The host logs a durable
   * `file/annotation` event so the markers reach the model's context and the
   * client's right-side tags; an absent selection service fails with
   * `file-tree-unavailable`.
   */
  annotate(
    request: RpcRequest<{ sessionId: SessionId; annotations: FileAnnotation[] }>,
  ): Promise<RpcResponse<{ annotations: FileAnnotation[] }>>

  /**
   * Read a session's latest edit-marker set (including completion statuses the
   * host derived from the model's file edits). Absent markers return an empty
   * list; an absent selection service fails with `file-tree-unavailable`.
   */
  annotations(
    request: RpcRequest<{ sessionId: SessionId }>,
  ): Promise<RpcResponse<{ annotations: FileAnnotation[] }>>
}
