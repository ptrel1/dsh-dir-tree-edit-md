/**
 * The file-tree browsing store: loaded listings, expanded directories, and
 * the multi-select set. Live listings are process-local (no persist); a reload
 * re-lists from the Host. The change signal (re-list trigger) is a separate
 * `hooks`-compartment observable, not store state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileTreeEntry, FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

/** Active name search (null = plain browsing). Matches are flat; the view rebuilds the hierarchy. */
export type FileTreeSearchState = {
  /** The exact query the matches were produced for (the view compares it to the live box). */
  query: string
  /** Flat name matches, in host walk order; ancestors not included. */
  matches: FileTreeEntry[]
  /** The host capped the walk; the view renders a truncation notice. */
  truncated: boolean
  /** The last run failed; the view renders a retry affordance. */
  failed: boolean
}

/** File-tree browsing state (process-local; nothing here is durable). */
type FileTreeState = {
  /** Loaded listing by directory path. */
  children: Record<string, FileTreeListing>
  /** Expanded directory paths (re-listed when the host reports a change). */
  expanded: string[]
  /** Selected paths (multi-select highlight). */
  selection: string[]
  /** Failed levels, keyed by directory path; renders a retry row instead of a stuck spinner. */
  failed: Record<string, boolean>
  /** Active name search; null while browsing the plain tree. */
  search: FileTreeSearchState | null
}

/** Store write set, derived from the actions literal for drift-free typing. */
type FileTreeActions = {
  setChildren: (d: FileTreeState, path: string, listing: FileTreeListing) => void
  setExpanded: (d: FileTreeState, path: string, expanded: boolean) => void
  toggleSelection: (d: FileTreeState, path: string) => void
  setFailed: (d: FileTreeState, path: string, failed: boolean) => void
  setSearch: (d: FileTreeState, search: FileTreeSearchState) => void
  clearChildren: (d: FileTreeState) => void
  clearExpanded: (d: FileTreeState) => void
  clearSelection: (d: FileTreeState) => void
  clearFailed: (d: FileTreeState) => void
  clearSearch: (d: FileTreeState) => void
}

/**
 * Create the file-tree browsing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFileTreeStore(): EngineStoreHandle<FileTreeState, FileTreeActions> {
  return defineStore({
    init: (): FileTreeState => ({ children: {}, expanded: [], selection: [], failed: {}, search: null }),
    actions: {
      setChildren: (d, path, listing) => { d.children[path] = listing },
      setExpanded: (d, path, expanded) => {
        d.expanded = expanded
          ? [...new Set([...d.expanded, path])]
          : d.expanded.filter(p => p !== path)
      },
      toggleSelection: (d, path) => {
        d.selection = d.selection.includes(path)
          ? d.selection.filter(p => p !== path)
          : [...d.selection, path]
      },
      setFailed: (d, path, failed) => { d.failed[path] = failed },
      setSearch: (d, search) => { d.search = search },
      clearChildren: (d) => { d.children = {} },
      clearExpanded: (d) => { d.expanded = [] },
      clearSelection: (d) => { d.selection = [] },
      clearFailed: (d) => { d.failed = {} },
      clearSearch: (d) => { d.search = null },
    },
  })
}
