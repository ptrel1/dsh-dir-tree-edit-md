/**
 * Durable file-selection event vocabulary. Type-only and client-safe.
 * @module @deepseek-ai/dsh-file-selection/types
 */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The user changed the file tree's selected-file set. Replaces the prior
     * selection (an empty `files` clears it). Logged so the model-visible
     * "selected files" context is reconstructable from the session log.
     */
    'file/selection': { files: string[] }
  }
}

export {}
