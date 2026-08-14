/**
 * The sidebar file-tree occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Reads the current session's workspace root
 * and renders one lazy directory level per expansion; a `filetree/change`
 * signal re-lists the expanded view without polling. A name-search box above
 * the tree filters in place: the tree shape survives, matches stay put with
 * their real ancestors and synthesized connecting levels, and clearing the
 * query restores the plain tree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconCloseFill14, IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FileTreeEntry, FileTreeEntryKind, FileTreeGitStatus, FileTreeListing, FileTreeSearchResult, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, PropsLocale, PropsRuntime, PropsStore, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { createFileTreeStore } from './store.ts'
import type { FilterTreeNode } from './search.ts'
import { buildFilteredTree } from './search.ts'
import css from './FileTree.module.css'

/** Injected wire face bound in apply's closure. */
export interface FileTreeInjected {
  /** List one directory level; the signal aborts a superseded scan. */
  listDir: (path: string, signal?: AbortSignal) => Promise<FileTreeListing>
  /** Search file and directory names under the workspace root. */
  searchEntries: (root: string, query: string, signal?: AbortSignal) => Promise<FileTreeSearchResult>
  /** Open a path with the operating system's default application. */
  openPath: (path: string) => Promise<void>
  /** Copy a path to the clipboard (fire-and-forget). */
  copyPath: (path: string) => void
  /** Record the session's selected-file set (fire-and-forget). */
  selectFiles: (sessionId: SessionId, files: string[]) => void
}

/** Bound hooks the renderer derives from the injected `hooks` compartment. */
export interface FileTreeHooks {
  useFileTreeChange: SnapshotSelectorHook<{ revision: number }>
}

/** The inject-return source shape the renderer binds (apply returns this). */
export interface FileTreeHookSources {
  hooks: {
    fileTreeChange: HostObservable<{ revision: number }>
  }
}

/** Full tree props: runtime share + viewing store + injected wire face + bound hooks + locale. */
export type FileTreeProps =
  PropsRuntime<'sidebar.filetree'>
  & PropsStore<ReturnType<typeof createFileTreeStore>>
  & FileTreeInjected
  & FileTreeHooks
  & PropsLocale<'filetree'>

/** In-flight listing paths (loading state is surface-local, not store state). */
type Busy = Set<string>

/**
 * Client-side listing deadline: generous margin over the host's own
 * git-status deadline so a healthy listing never trips it, while a stalled
 * RPC still settles into the retry row instead of a stuck spinner.
 */
const LIST_TIMEOUT_MS = 15000

/** Pause between the latest keystroke and a Host name-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `filetree.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500

/** Keep controlled input and RPC payload inside the filetree.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/**
 * Render the file tree.
 * @param props - composed slot props (runtime share + store + injected + hooks + locale).
 * @returns the tree element.
 */
export function FileTree({
  useSessions, useStore, actions, listDir, searchEntries, openPath, copyPath, selectFiles, useFileTreeChange, t,
}: FileTreeProps) {
  const list = useSessions(s => s)
  const currentId = list.current
  const cwd = currentId === undefined ? undefined : list.byId[currentId]?.cwd
  const children = useStore(s => s.children)
  const expanded = useStore(s => s.expanded)
  const selection = useStore(s => s.selection)
  const failed = useStore(s => s.failed)
  const search = useStore(s => s.search)
  const change = useFileTreeChange(s => s.revision)

  const [busy, setBusy] = useState<Busy>(new Set())

  /** Live controllers per listed path; a re-list aborts and supersedes the prior request. */
  const pending = useRef(new Map<string, AbortController>())

  const load = useCallback((path: string) => {
    // Change storms re-list one directory many times before the first call
    // settles; abort the stale request so the level always tracks the latest.
    pending.current.get(path)?.abort()
    const controller = new AbortController()
    pending.current.set(path, controller)
    const timer = setTimeout(() => { controller.abort() }, LIST_TIMEOUT_MS)
    setBusy(current => new Set(current).add(path))
    actions.setFailed(path, false)
    void listDir(path, controller.signal).then(
      (listing) => {
        clearTimeout(timer)
        pending.current.delete(path)
        actions.setChildren(path, listing)
        setBusy((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      },
      () => {
        clearTimeout(timer)
        // Superseded by a newer request for this path: that request owns the level.
        if (pending.current.get(path) !== controller) return
        pending.current.delete(path)
        actions.setFailed(path, true)
        setBusy((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      },
    )
  }, [listDir, actions])

  /** Controlled search box value; the store's query is the settled, debounced one. */
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim()
  /** IME composition guard: a committed keystroke must not trigger Escape handling. */
  const composingRef = useRef(false)
  /** The single live search controller; a newer query aborts and supersedes the prior run. */
  const searchPending = useRef<AbortController | undefined>(undefined)

  const runSearch = useCallback((q: string) => {
    if (cwd === undefined) return
    searchPending.current?.abort()
    const controller = new AbortController()
    searchPending.current = controller
    void searchEntries(cwd, q, controller.signal).then(
      (result) => {
        if (searchPending.current !== controller) return
        searchPending.current = undefined
        actions.setSearch({ query: q, matches: result.matches, truncated: result.truncated, failed: false })
      },
      () => {
        // Superseded (a newer query aborted this run): the newer run owns the slice.
        if (searchPending.current !== controller) return
        searchPending.current = undefined
        actions.setSearch({ query: q, matches: [], truncated: false, failed: true })
      },
    )
  }, [cwd, searchEntries, actions])

  // Debounced search driver: empty/absent input clears the slice and aborts the
  // in-flight run; a non-empty query re-fires 250ms after the last keystroke.
  useEffect(() => {
    if (normalizedQuery === '' || cwd === undefined) {
      searchPending.current?.abort()
      searchPending.current = undefined
      actions.clearSearch()
      return
    }
    const timer = setTimeout(() => { runSearch(normalizedQuery) }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      // A newer query (or workspace switch) aborts the superseded run; its
      // rejection must not land on the store, so drop the ownership token.
      searchPending.current?.abort()
      searchPending.current = undefined
    }
  }, [normalizedQuery, cwd, runSearch, actions])

  // Cancel every in-flight listing when the tree unmounts.
  useEffect(() => () => {
    for (const controller of pending.current.values()) controller.abort()
    pending.current.clear()
    searchPending.current?.abort()
  }, [])

  // Reset on workspace change: a different root must not leak the prior tree.
  useEffect(() => {
    actions.clearChildren()
    actions.clearSelection()
    actions.clearExpanded()
    actions.clearFailed()
    if (cwd !== undefined) load(cwd)
  }, [cwd, actions, load])

  // Re-list the root and every expanded level when the host reports a change.
  useEffect(() => {
    if (cwd === undefined) return
    load(cwd)
    for (const path of expanded) load(path)
  }, [change, load])

  // Re-run the settled search (no debounce) when the host reports a change;
  // change storms converge through the abort-and-supersede chain.
  useEffect(() => {
    if (cwd !== undefined && search !== null) runSearch(search.query)
  }, [change])

  // Sync the multi-select to the host on every change (empty clears it).
  useEffect(() => {
    if (currentId !== undefined) selectFiles(currentId, selection)
  }, [currentId, selection, selectFiles])

  // Filtered body: real matches plus synthesized ancestors, all auto-expanded.
  const filteredTree = useMemo(
    () => search === null || cwd === undefined ? undefined : buildFilteredTree(cwd, search.matches),
    [cwd, search],
  )

  if (cwd === undefined) {
    return (
      <div className={clsx(css.root, css.wide)}>
        <div className={css.empty}>{t('empty.noWorkspace')}</div>
      </div>
    )
  }

  const toggleDir = (path: string): void => {
    if (expanded.includes(path)) {
      actions.setExpanded(path, false)
    } else {
      actions.setExpanded(path, true)
      if (children[path] === undefined) load(path)
    }
  }

  // Clicking a filtered directory clears the search and reveals the directory
  // in the plain tree: expand every ancestor level and load the missing ones.
  const revealDir = (node: FilterTreeNode): void => {
    setQuery('')
    const chain: FilterTreeNode[] = []
    for (let cursor: FilterTreeNode | undefined = node; cursor !== undefined && cursor.path !== cwd; cursor = cursor.parent) {
      chain.push(cursor)
    }
    for (const ancestor of chain) {
      actions.setExpanded(ancestor.path, true)
      if (children[ancestor.path] === undefined && !busy.has(ancestor.path)) load(ancestor.path)
    }
  }

  const rows = (parent: string): FileTreeEntry[] => {
    const listing = children[parent]
    if (listing === undefined) return []
    const dirs = listing.entries.filter(e => e.kind === 'directory')
    const files = listing.entries.filter(e => e.kind === 'file')
    return [...dirs, ...files]
  }

  /** One tree row: shared by the plain and filtered bodies (same indent, ink, and actions). */
  const renderRow = (row: {
    path: string
    name: string
    kind: FileTreeEntryKind
    gitStatus: FileTreeGitStatus | undefined
    chevron: string
    onLabel: () => void
  }, depth: number): ReactNode => {
    const selected = selection.includes(row.path)
    return (
      <div
        key={row.path}
        className={clsx(css.row, selected && css.rowSelected)}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        role="treeitem"
        aria-selected={selected}
      >
        <button
          type="button"
          className={clsx(css.rowLabel, row.gitStatus !== undefined && css[`git_${row.gitStatus}`])}
          onClick={row.onLabel}
        >
          <span className={css.chevron}>{row.chevron}</span>
          <span className={css.name}>{row.name}</span>
        </button>
        <span className={css.rowActions}>
          <button type="button" className={css.rowAction} aria-label={t('action.copy')} title={t('action.copy')} onClick={() => { copyPath(row.path) }}>
            {t('action.copy')}
          </button>
          <button type="button" className={css.rowAction} aria-label={t('action.open')} title={t('action.open')} onClick={() => { void openPath(row.path) }}>
            {t('action.open')}
          </button>
        </span>
      </div>
    )
  }

  const renderLevel = (parent: string, depth: number): ReactNode => rows(parent).map((entry) => {
    const isDir = entry.kind === 'directory'
    const isOpen = isDir && expanded.includes(entry.path)
    return (
      <div key={entry.path}>
        {renderRow({
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          gitStatus: entry.gitStatus,
          chevron: isDir ? (isOpen ? '▾' : '▸') : '',
          onLabel: () => {
            if (isDir) toggleDir(entry.path)
            else actions.toggleSelection(entry.path)
          },
        }, depth)}
        {isDir && isOpen && (
          <>
            {busy.has(entry.path) && children[entry.path] === undefined
              ? <div className={css.status}>{t('loading')}</div>
              : failed[entry.path] && (
                <button type="button" className={css.retry} onClick={() => { load(entry.path) }}>
                  {t('error.loadFailed')}
                </button>
              )}
            {children[entry.path] !== undefined && renderLevel(entry.path, depth + 1)}
          </>
        )}
      </div>
    )
  })

  const renderFilteredLevel = (node: FilterTreeNode, depth: number): ReactNode => (
    <div key={node.path}>
      {renderRow({
        path: node.path,
        name: node.name,
        kind: node.kind,
        // Synthesized ancestors were never listed: no git ink on them.
        gitStatus: node.synthesized ? undefined : node.gitStatus,
        chevron: node.kind === 'directory' ? '▾' : '',
        onLabel: () => {
          if (node.kind === 'directory') revealDir(node)
          else actions.toggleSelection(node.path)
        },
      }, depth)}
      {node.children.map(child => renderFilteredLevel(child, depth + 1))}
    </div>
  )

  const filtering = normalizedQuery !== ''
  // Pending: no settled slice yet, or the settled slice belongs to an older query.
  const searchPendingView = filtering && (search === null || search.query !== normalizedQuery)

  // Tree body: the filtered view owns the stage while a query is active,
  // falling back to the plain lazy tree once the box clears.
  let body: ReactNode
  if (!filtering) {
    body = (
      <>
        {busy.has(cwd) && children[cwd] === undefined
          ? <div className={css.status}>{t('loading')}</div>
          : failed[cwd] && (
            <button type="button" className={css.retry} onClick={() => { load(cwd) }}>
              {t('error.loadFailed')}
            </button>
          )}
        {renderLevel(cwd, 0)}
      </>
    )
  } else if (searchPendingView) {
    body = <div className={css.status}>{t('loading')}</div>
  } else if (search !== null && search.failed) {
    body = (
      <button type="button" className={css.retry} onClick={() => { runSearch(search.query) }}>
        {t('search.failed')}
      </button>
    )
  } else if (search !== null && search.matches.length === 0) {
    body = <div className={css.status}>{t('search.noMatches')}</div>
  } else {
    body = (
      <>
        {filteredTree !== undefined && filteredTree.children.map(child => renderFilteredLevel(child, 0))}
        {search !== null && search.truncated && <div className={css.status}>{t('search.truncated')}</div>}
      </>
    )
  }

  return (
    <div className={clsx(css.root, css.wide)}>
      <div className={css.searchBar}>
        <div className={css.searchBox}>
          <Input
            className={clsx(css.searchInput)}
            icon={<IconSearchOutline16 />}
            type="text"
            role="searchbox"
            aria-label={t('search.aria')}
            placeholder={t('search.placeholder')}
            maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
            value={query}
            onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !composingRef.current) setQuery('')
            }}
          />
          {query !== '' && (
            <button type="button" className={css.clearButton} aria-label={t('search.clear')} onClick={() => { setQuery('') }}>
              <IconCloseFill14 />
            </button>
          )}
        </div>
      </div>
      <div className={css.treeBody} role="tree" aria-label={t('tree.label')}>
        {body}
      </div>
    </div>
  )
}
