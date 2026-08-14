/**
 * filetree domain contract. Wire projection of the host-side file-tree
 * capability (@deepseek-ai/dsh-host-file-tree): one directory level with
 * per-file git status. Method signatures are the source of truth.
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
  /** Git status for a file; absent for directories and paths outside any git work tree. */
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

/** File-tree unary methods. */
export interface FileTreeApi {
  /**
   * List one directory level with per-file git status. The caller supplies the
   * absolute directory (a session's workspace root). Unreadable or missing
   * targets fail with `tree-unreadable`; the carrier's request signal follows
   * the caller, stopping the backend's scan on disconnect or timeout.
   */
  list(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FileTreeListing>>

  /**
   * Record a session's selected-file set (the file tree's multi-select). The
   * host logs a durable `file/selection` event so the selection reaches the
   * model's context; an absent selection service fails with
   * `file-tree-unavailable`.
   */
  select(
    request: RpcRequest<{ sessionId: SessionId; files: string[] }>,
  ): Promise<RpcResponse<{ selected: string[] }>>
}
