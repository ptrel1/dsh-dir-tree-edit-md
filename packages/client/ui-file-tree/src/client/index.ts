/**
 * File-tree surface, browser half: fills the sidebar shell's `sidebar.filetree`
 * hole with the workspace directory tree, re-listing on `filetree/change`.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.filetree' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { FileTreeInjected, FileTreeHookSources } from './FileTree.tsx'
import { FileTree } from './FileTree.tsx'
import type { MarkPanelInjected } from './MarkPanel.tsx'
import { MarkPanel } from './MarkPanel.tsx'
import { createFileTreeStore } from './store.ts'
import { en, zh, type FileTreeKey } from './locales.ts'

/** Locale namespace owning the tree's copy. */
const NS = 'filetree'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-tree surface copy. */
    filetree: FileTreeKey
  }
}

/**
 * Required services (cordis fiber inject): slots, the wire-facing workspaces
 * service, remote, locale, and layout (the dock width driver for the mark
 * panel's rightmost column).
 */
export const inject = ['slots', 'workspaces', 'locale', 'remote', 'layout']

/**
 * Client plugin body: register the dictionaries, the change signal, and the
 * tree into the shell's `sidebar.filetree` hole.
 * @param ctx - client root context.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The rightmost dock column seat, registered by this package's MarkPanel:
     * the edit-marker occupant that renders a collapsed vertical tag rail (one
     * filename chip per opened file) or an expanded editor with highlighted
     * marked lines once a file is open. The occupant drives the column's width
     * through the layout `setDockMode` inject; the layout frame owns the
     * track's geometry and border. Absence collapses the column to nothing —
     * no occupant, no width (broken-composition state; the shipped composition
     * always registers the seat).
     */
    'shell.dock': { kind: 'single'; scope: 'root'; owner: Record<string, never> }
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-tree: dictionaries')

  // The change signal is a registrant-private observable the renderer binds to
  // `useFileTreeChange`; the component re-lists its expanded view on a bump.
  const changeSignal = createSnapshotStore({ revision: 0 })

  const injected = (): FileTreeInjected & FileTreeHookSources => ({
    listDir: (path, signal) => ctx.workspaces.listDir(path, signal),
    searchEntries: (root, query, signal) => ctx.workspaces.searchEntries(root, query, signal),
    openPath: path => ctx.workspaces.openPath(path),
    copyPath: (path) => {
      void navigator.clipboard.writeText(path).catch(() => {
        // Clipboard unavailable (insecure context); the row still shows the path.
      })
    },
    selectFiles: (sessionId, files) => {
      void ctx.workspaces.selectFiles(sessionId, files).catch(() => {
        // Selection sync is best-effort; the tree keeps its local highlight.
      })
    },
    readFile: path => ctx.workspaces.readFile(path),
    annotateFiles: (sessionId, annotations) => {
      void ctx.workspaces.annotateFiles(sessionId, annotations).catch(() => {
        // Marker sync is best-effort; the panel keeps its local view.
      })
    },
    readAnnotations: sessionId => ctx.workspaces.readAnnotations(sessionId),
    hooks: { fileTreeChange: changeSignal },
  })

  // One handle shared by the tree and the dock: both entries resolve to the
  // same store instance, so a mark opened from the tree shows in the panel and
  // a tag click lands back in the tree's state without cross-slot plumbing.
  const fileTreeStore = createFileTreeStore()

  ctx.effect(() => {
    const offChange = ctx.remote.$on('filetree/change', () => {
      changeSignal.update((d) => { d.revision += 1 })
    })
    const offTree = ctx.slots.inject('sidebar.filetree', () => ctx.slots.register({
      name: 'sidebar.filetree',
      locale: NS,
      store: fileTreeStore,
      inject: injected,
    }, FileTree))
    const offDetails = ctx.slots.inject('details', () => ctx.slots.register({
      name: 'details',
      locale: NS,
      store: fileTreeStore,
      inject: (): MarkPanelInjected => ({
        readFile: path => ctx.workspaces.readFile(path),
        setDockMode: (mode) => {
          if (mode === 'expanded' || mode === 'rail') {
            ctx.layout?.openDetails()
          } else if (mode === 'closed') {
            ctx.layout?.closeDetails()
          }
        },
      }),
    }, MarkPanel))
    return () => { offChange(); offTree(); offDock(); offDetails() }
  }, 'ui-file-tree: registration')
}
