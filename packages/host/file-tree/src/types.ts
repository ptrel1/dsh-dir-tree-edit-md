/**
 * Type-only file-tree contract: the listing vocabulary and the Cordis event
 * declaration, shared with type-only consumers. Client-safe: nothing here
 * reaches a Host-only symbol, so a Client compilation face reads the same
 * `filetree/change` signature the Host emits.
 * @module @deepseek-ai/dsh-host-file-tree/types
 */

/** The kind of one listed child. */
export type FileTreeEntryKind = 'file' | 'directory'

/** Git working-tree status of one file entry (the classic set). */
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
  /**
   * Git status for the row: a file reports its own; a directory aggregates
   * the highest-ranked status of anything below it at any depth. Absent
   * outside any git work tree.
   */
  gitStatus?: FileTreeGitStatus
}

/** One directory level as a backend reports it. */
export interface FileTreeListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Direct children (files and directories), name-sorted; the client owns directory-first grouping. */
  entries: FileTreeEntry[]
  /** True when the backend cut `entries` at its complete-result bound: the level has more children than reported. */
  truncated: boolean
}

/** Closed failure vocabulary of the listing primitive (mirrored onto the wire by consumers). */
export type FileTreeErrorCode = 'tree-unreadable'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The watched tree under `root` changed. `paths` names the affected
     * absolute paths when known; an empty array means the change's scope is
     * unknown and consumers should refresh their whole expanded view under
     * `root`. Consumers (the RPC forwarder) relay this to clients, which
     * re-list only their expanded levels.
     * @param root - the absolute watched root that changed.
     * @param paths - affected absolute paths, or empty for an unknown scope.
     * @mode emit
     */
    'filetree/change'(root: string, paths: readonly string[]): void
  }
}
