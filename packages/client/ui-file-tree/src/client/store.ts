/**
 * The file-tree browsing store: loaded listings, expanded directories, and
 * the multi-select set. Live listings are process-local (no persist); a reload
 * re-lists from the Host. The change signal (re-list trigger) is a separate
 * `hooks`-compartment observable, not store state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

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
}

/** Store write set, derived from the actions literal for drift-free typing. */
type FileTreeActions = {
  setChildren: (d: FileTreeState, path: string, listing: FileTreeListing) => void
  setExpanded: (d: FileTreeState, path: string, expanded: boolean) => void
  toggleSelection: (d: FileTreeState, path: string) => void
  setFailed: (d: FileTreeState, path: string, failed: boolean) => void
  clearChildren: (d: FileTreeState) => void
  clearExpanded: (d: FileTreeState) => void
  clearSelection: (d: FileTreeState) => void
  clearFailed: (d: FileTreeState) => void
}

/**
 * Create the file-tree browsing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFileTreeStore(): EngineStoreHandle<FileTreeState, FileTreeActions> {
  return defineStore({
    init: (): FileTreeState => ({ children: {}, expanded: [], selection: [], failed: {} }),
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
      clearChildren: (d) => { d.children = {} },
      clearExpanded: (d) => { d.expanded = [] },
      clearSelection: (d) => { d.selection = [] },
      clearFailed: (d) => { d.failed = {} },
    },
  })
}
