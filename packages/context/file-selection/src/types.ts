/**
 * Durable file-selection event vocabulary. Type-only and client-safe.
 * @module @deepseek-ai/dsh-file-selection/types
 */

/** One text-region edit marker's completion state. */
export type FileAnnotationStatus = 'pending' | 'done'

/** One user-marked text region plus the instruction the model should carry out there. */
export interface FileAnnotation {
  /** Client-generated stable identity. */
  id: string
  /** Absolute path of the marked file. */
  path: string
  /** 1-based first line of the marked region (inclusive). */
  startLine: number
  /** 1-based last line of the marked region (inclusive). */
  endLine: number
  /** 1-based column of the region start within its line (inclusive). */
  startColumn: number
  /** 1-based column of the region end within its line (exclusive). */
  endColumn: number
  /** The selected text snapshot at mark time. */
  text: string
  /** The user's instruction to the model for this region. */
  instruction: string
  /** Completion state: `pending` until the model edits the file, then `done`. */
  status: FileAnnotationStatus
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The user changed the file tree's selected-file set. Replaces the prior
     * selection (an empty `files` clears it). Logged so the model-visible
     * "selected files" context is reconstructable from the session log.
     */
    'file/selection': { files: string[] }
    /**
     * The user changed the file tree's edit-marker set (the annotated text
     * regions and their instructions). Replaces the prior set (an empty
     * `annotations` clears it). The model-visible "file edit markers" context
     * and the client's right-side tags both read this back from the log, so a
     * replay rebuilds the same view.
     */
    'file/annotation': { annotations: FileAnnotation[] }
  }
}

export {}
