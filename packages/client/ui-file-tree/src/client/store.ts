/**
 * The file-tree browsing store: loaded listings, expanded directories, the
 * multi-select set, the edit-marker set, and the open editor surface. Live
 * listings and markers are process-local (no persist); a reload re-lists from
 * the Host. The change signal (re-list trigger) is a separate `hooks`
 * compartment observable, not store state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileAnnotation, FileTreeEntry, FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

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

/** One open editor surface (the right-side edit-marker panel). */
export type FileEditorState = {
  /** Absolute path of the file being viewed. */
  path: string
  /** Decoded text (a prefix when `truncated`); empty while the read is in flight. */
  text: string
  /** The host capped the read; the editor notes the file continues. */
  truncated: boolean
  /** Syntax-highlighting language hint, or absent for plain text. */
  language?: string
  /** The read failed (binary or unreadable); the editor shows a message instead of content. */
  failed: boolean
  /** Operator-facing failure reason, when `failed`. */
  error?: string
  /** The host read is in flight; the editor shows a loading affordance instead of content. */
  loading?: boolean
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
  /** Edit markers by absolute file path (the right-side tags + editor highlights). */
  annotations: Record<string, FileAnnotation[]>
  /** Paths opened through the edit-marker action, in open order. A file stays
   * on the dock's tag rail after its editor closes — the rail derives from
   * this list, not from `annotations`, so merely opening a file leaves a tag. */
  marked: string[]
  /** The open editor surface; null when no file is being marked. */
  editor: FileEditorState | null
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
  setAnnotations: (d: FileTreeState, annotations: FileAnnotation[]) => void
  mergeAnnotationStatuses: (d: FileTreeState, annotations: FileAnnotation[]) => void
  addAnnotation: (d: FileTreeState, path: string, annotation: FileAnnotation) => void
  removeAnnotation: (d: FileTreeState, path: string, id: string) => void
  clearAnnotations: (d: FileTreeState) => void
  markOpened: (d: FileTreeState, path: string) => void
  closeMarked: (d: FileTreeState, path: string) => void
  clearMarked: (d: FileTreeState) => void
  setEditor: (d: FileTreeState, editor: FileEditorState | null) => void
}

/** Rebuild the per-path annotation map from a flat list (host order preserved). */
function annotationsByPath(annotations: FileAnnotation[]): Record<string, FileAnnotation[]> {
  const byPath: Record<string, FileAnnotation[]> = {}
  for (const annotation of annotations) {
    const list = byPath[annotation.path]
    if (list === undefined) byPath[annotation.path] = [annotation]
    else list.push(annotation)
  }
  return byPath
}

/** The complete flat marker list in path-major order (the wire shape). */
export function flatAnnotations(annotations: Record<string, FileAnnotation[]>): FileAnnotation[] {
  return Object.values(annotations).flat()
}

/**
 * Create the file-tree browsing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFileTreeStore(): EngineStoreHandle<FileTreeState, FileTreeActions> {
  return defineStore({
    init: (): FileTreeState => ({
      children: {}, expanded: [], selection: [], failed: {}, search: null, annotations: {}, marked: [], editor: null,
    }),
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
      // Replaces the whole marker set from the host's authoritative list (used
      // on initial sync and on re-read after a `filetree/change`, so completion
      // statuses the host derived flow back into the tags).
      setAnnotations: (d, annotations) => { d.annotations = annotationsByPath(annotations) },
      // Adopt completion statuses the host derived (matching by id), without
      // removing markers the host has not yet received from the client.
      mergeAnnotationStatuses: (d, annotations) => {
        const statusById = new Map(annotations.map(a => [a.id, a.status]))
        for (const path of Object.keys(d.annotations)) {
          const list = d.annotations[path]
          if (list === undefined) continue
          d.annotations[path] = list.map((a) => {
            const status = statusById.get(a.id)
            return status === undefined ? a : { ...a, status }
          })
        }
      },
      addAnnotation: (d, path, annotation) => {
        const list = d.annotations[path]
        d.annotations[path] = list === undefined ? [annotation] : [...list, annotation]
      },
      removeAnnotation: (d, path, id) => {
        const list = d.annotations[path]
        d.annotations[path] = list === undefined ? [] : list.filter(a => a.id !== id)
      },
      clearAnnotations: (d) => { d.annotations = {} },
      // Idempotent: a file already on the rail stays once (open order preserved).
      markOpened: (d, path) => {
        if (d.marked.includes(path)) return
        d.marked = [...d.marked, path]
      },
      // The tag's ✕: drop the file from the rail AND clear every marker it
      // carries (the tag is the file's closure affordance), closing the editor
      // if it was showing this file.
      closeMarked: (d, path) => {
        d.marked = d.marked.filter(p => p !== path)
        if (d.annotations[path] !== undefined) {
          const { [path]: _removed, ...rest } = d.annotations
          d.annotations = rest
        }
        if (d.editor?.path === path) d.editor = null
      },
      clearMarked: (d) => { d.marked = [] },
      setEditor: (d, editor) => { d.editor = editor },
    },
  })
}
