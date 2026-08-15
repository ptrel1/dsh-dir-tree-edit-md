/**
 * The edit-marker open gesture: record the file on the dock's tag rail, then
 * read it through the wire face and settle the editor surface. Shared by the
 * sidebar tree (context-menu row) and the dock panel (tag click) — both write
 * the same shared store, so one implementation keeps the two call sites in
 * step. Pure: all dependencies (actions, readFile) arrive as parameters.
 * @module
 */
import type { FileTreeReadResult } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createFileTreeStore } from './store.ts'

/** The shared store's bound action set (framework-baked, draft params peeled). */
type FileTreeActions = BoundActions<ReturnType<typeof createFileTreeStore>>

/** The wire face that reads one file for the editor. */
export type ReadFile = (path: string) => Promise<FileTreeReadResult>

/**
 * Open the edit-marker editor for one file. Immediately marks the path so the
 * dock rail keeps a tag, then reads and fills the editor (a read failure
 * settles the failed surface instead of leaving a spinner).
 * @param actions - the shared file-tree store's bound actions.
 * @param readFile - host read face.
 * @param path - absolute file path to open.
 */
export function openEditor(actions: FileTreeActions, readFile: ReadFile, path: string): void {
  actions.markOpened(path)
  // Empty surface, read in flight: the editor shows a loading affordance for
  // large files instead of an empty body while the wire read settles.
  actions.setEditor({ path, text: '', truncated: false, failed: false, loading: true })
  void readFile(path).then(
    (result) => {
      actions.setEditor({
        path: result.path, text: result.text, truncated: result.truncated, failed: false, loading: false,
        ...(result.language === undefined ? {} : { language: result.language }),
      })
    },
    (error: unknown) => {
      actions.setEditor({
        path, text: '', truncated: false, failed: true, loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  )
}
