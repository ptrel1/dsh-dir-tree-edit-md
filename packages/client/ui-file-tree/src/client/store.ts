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
export type FileTreeState = {
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
  /** Paths opened through the edit-marker action, in open order. */
  marked: string[]
  /** The open editor surface; null when no file is being marked. */
  editor: FileEditorState | null
}

/** Store write set for the file-tree browsing surface. */
export type FileTreeActions = {
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

/** Edit-marker panel state (session-scoped; lives in details slot). */
export type MarkPanelState = {
  /** Edit markers by absolute file path (the right-side tags + editor highlights). */
  annotations: Record<string, FileAnnotation[]>
  /** Paths opened through the edit-marker action, in open order. */
  marked: string[]
  /** The open editor surface; null when no file is being marked. */
  editor: FileEditorState | null
}

/** Store write set for the edit-marker dock panel. */
export type MarkPanelActions = {
  setAnnotations: (d: MarkPanelState, annotations: FileAnnotation[]) => void
  mergeAnnotationStatuses: (d: MarkPanelState, annotations: FileAnnotation[]) => void
  addAnnotation: (d: MarkPanelState, path: string, annotation: FileAnnotation) => void
  removeAnnotation: (d: MarkPanelState, path: string, id: string) => void
  clearAnnotations: (d: MarkPanelState) => void
  markOpened: (d: MarkPanelState, path: string) => void
  closeMarked: (d: MarkPanelState, path: string) => void
  clearMarked: (d: MarkPanelState) => void
  setEditor: (d: MarkPanelState, editor: FileEditorState | null) => void
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

/**
 * The complete flat marker list in path-major order (the wire shape).
 * @param annotations - annotations grouped by file path.
 * @returns every annotation flattened, one entry per marker.
 */
export function flatAnnotations(annotations: Record<string, FileAnnotation[]>): FileAnnotation[] {
  return Object.values(annotations).flat()
}

/**
 * Create the file-tree browsing store handle (root-scoped).
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
      setAnnotations: (d, annotations) => { d.annotations = annotationsByPath(annotations) },
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
      markOpened: (d, path) => {
        if (d.marked.includes(path)) return
        d.marked = [...d.marked, path]
      },
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

/**
 * Create the edit-marker dock panel store handle (session-scoped).
 * @returns the store handle for MarkPanel.
 */
export function createMarkPanelStore(): EngineStoreHandle<MarkPanelState, MarkPanelActions> {
  return defineStore({
    init: (): MarkPanelState => ({
      annotations: {}, marked: [], editor: null,
    }),
    actions: {
      setAnnotations: (d, annotations) => { d.annotations = annotationsByPath(annotations) },
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
      markOpened: (d, path) => {
        if (d.marked.includes(path)) return
        d.marked = [...d.marked, path]
      },
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
