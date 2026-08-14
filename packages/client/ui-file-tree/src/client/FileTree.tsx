/**
 * The sidebar file-tree occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Reads the current session's workspace root
 * and renders one lazy directory level per expansion; a `filetree/change`
 * signal re-lists the expanded view without polling.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { FileTreeEntry, FileTreeListing, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, PropsLocale, PropsRuntime, PropsStore, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { createFileTreeStore } from './store.ts'
import css from './FileTree.module.css'

/** Injected wire face bound in apply's closure. */
export interface FileTreeInjected {
  /** List one directory level; the signal aborts a superseded scan. */
  listDir: (path: string, signal?: AbortSignal) => Promise<FileTreeListing>
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

/**
 * Render the file tree.
 * @param props - composed slot props (runtime share + store + injected + hooks + locale).
 * @returns the tree element.
 */
export function FileTree({
  useSessions, useStore, actions, listDir, openPath, copyPath, selectFiles, useFileTreeChange, t,
}: FileTreeProps) {
  const list = useSessions(s => s)
  const currentId = list.current
  const cwd = currentId === undefined ? undefined : list.byId[currentId]?.cwd
  const children = useStore(s => s.children)
  const expanded = useStore(s => s.expanded)
  const selection = useStore(s => s.selection)
  const failed = useStore(s => s.failed)
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
    const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS)
    setBusy(current => new Set(current).add(path))
    actions.setFailed(path, false)
    void listDir(path, controller.signal).then(
      (listing) => {
        clearTimeout(timer)
        pending.current.delete(path)
        actions.setChildren(path, listing)
        setBusy(current => {
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
        setBusy(current => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      },
    )
  }, [listDir, actions])

  // Cancel every in-flight listing when the tree unmounts.
  useEffect(() => () => {
    for (const controller of pending.current.values()) controller.abort()
    pending.current.clear()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision-only retrigger; expanded/cwd ride the closure.
  }, [change, load])

  // Sync the multi-select to the host on every change (empty clears it).
  useEffect(() => {
    if (currentId !== undefined) selectFiles(currentId, selection)
  }, [currentId, selection, selectFiles])

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

  const rows = (parent: string): FileTreeEntry[] => {
    const listing = children[parent]
    if (listing === undefined) return []
    const dirs = listing.entries.filter(e => e.kind === 'directory')
    const files = listing.entries.filter(e => e.kind === 'file')
    return [...dirs, ...files]
  }

  const renderLevel = (parent: string, depth: number): ReactNode => rows(parent).map((entry) => {
    const isDir = entry.kind === 'directory'
    const isOpen = isDir && expanded.includes(entry.path)
    const selected = selection.includes(entry.path)
    return (
      <div key={entry.path}>
        <div
          className={clsx(css.row, selected && css.rowSelected)}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          role="treeitem"
          aria-selected={selected}
        >
          <button
            type="button"
            className={clsx(css.rowLabel, entry.gitStatus !== undefined && css[`git_${entry.gitStatus}`])}
            onClick={() => {
              if (isDir) toggleDir(entry.path)
              else actions.toggleSelection(entry.path)
            }}
          >
            <span className={css.chevron}>{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
            <span className={css.name}>{entry.name}</span>
          </button>
          <span className={css.rowActions}>
            <button type="button" className={css.rowAction} aria-label={t('action.copy')} title={t('action.copy')} onClick={() => { copyPath(entry.path) }}>
              {t('action.copy')}
            </button>
            <button type="button" className={css.rowAction} aria-label={t('action.open')} title={t('action.open')} onClick={() => { void openPath(entry.path) }}>
              {t('action.open')}
            </button>
          </span>
        </div>
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

  return (
    <div className={clsx(css.root, css.wide)} role="tree" aria-label={t('tree.label')}>
      {busy.has(cwd) && children[cwd] === undefined
        ? <div className={css.status}>{t('loading')}</div>
        : failed[cwd] && (
          <button type="button" className={css.retry} onClick={() => { load(cwd) }}>
            {t('error.loadFailed')}
          </button>
        )}
      {renderLevel(cwd, 0)}
    </div>
  )
}
