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

/** Required services (cordis fiber inject): slots, the wire-facing workspaces service, remote, and locale. */
export const inject = ['slots', 'workspaces', 'locale', 'remote']

/**
 * Client plugin body: register the dictionaries, the change signal, and the
 * tree into the shell's `sidebar.filetree` hole.
 * @param ctx - client root context.
 */
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
    hooks: { fileTreeChange: changeSignal },
  })

  ctx.effect(() => {
    const offChange = ctx.remote.$on('filetree/change', () => {
      changeSignal.update((d) => { d.revision += 1 })
    })
    const offSlot = ctx.slots.inject('sidebar.filetree', () => ctx.slots.register({
      name: 'sidebar.filetree',
      locale: NS,
      store: createFileTreeStore(),
      inject: injected,
    }, FileTree))
    return () => { offChange(); offSlot() }
  }, 'ui-file-tree: registration')
}
