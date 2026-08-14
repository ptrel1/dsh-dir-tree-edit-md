/**
 * File-selection context: logs the user's file-tree selection as a durable
 * `file/selection` event and renders the latest selection into the system
 * prompt as a sourced runtime context, so the model knows which files the
 * user marked.
 * @module @deepseek-ai/dsh-file-selection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agent` field onto AssembleContext (dsh-agent's merge).
import type {} from '@deepseek-ai/dsh-agent'
import type {} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileSelection: FileSelection
  }
}

/** True when the two path lists are equal (same length, same order). */
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((path, index) => path === b[index])
}

/**
 * File-selection service: records the selected-file set on a session and reads
 * the latest one back for the prompt context.
 */
export class FileSelection extends Service {
  static inject = ['systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'fileSelection')
    ctx.systemPrompt.context({
      name: 'file-selection',
      order: 200,
      text: (assemble: AssembleContext) => this.render(assemble),
    })
  }

  /**
   * Record a new selection. Identical consecutive selections are not re-logged.
   * @param session - the session whose selection changed.
   * @param files - the complete selected-path set (order preserved).
   */
  select(session: Session, files: readonly string[]): void {
    const snapshot = [...files]
    if (sameSelection(this.latest(session), snapshot)) return
    session.append('file/selection', { files: snapshot })
  }

  /**
   * The latest recorded selection, or an empty list before any selection.
   * @param session - the session to read.
   * @returns the selected paths in recorded order.
   */
  latest(session: Session): string[] {
    for (const event of [...session.events].reverse()) {
      if (event.type === 'file/selection') return [...event.data.files]
    }
    return []
  }

  /** Render the latest selection for one assembly; empty contributes nothing. */
  private render(assemble: AssembleContext): string {
    const session = assemble.agent?.session
    if (session === undefined) return ''
    const files = this.latest(session)
    if (files.length === 0) return ''
    return `Selected files (user-marked in the file tree):\n${files.map(path => `- ${path}`).join('\n')}`
  }
}

export default FileSelection
