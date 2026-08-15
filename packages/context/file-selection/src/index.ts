/**
 * File-selection context: logs the user's file-tree selection and edit markers
 * as durable session events and renders the latest snapshots into the system
 * prompt, so the model knows which files the user marked and what it was asked
 * to do in each annotated region. A pending marker flips to `done` when the
 * model's filesystem tools write or edit the marked file (observed through the
 * `tools/result` event), which the client's right-side tag reflects by color.
 * @module @deepseek-ai/dsh-file-selection
 */

import { isAbsolute, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the `agent` field onto AssembleContext (dsh-agent's merge).
import type {} from '@deepseek-ai/dsh-agent'
import type { FileAnnotation } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileSelection: FileSelection
  }
}

/** True when the two path lists are equal (same length, same order). */
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((path, index) => path === b[index])
}

/** True when the two annotation lists are equal (same order, same fields). */
function sameAnnotations(a: readonly FileAnnotation[], b: readonly FileAnnotation[]): boolean {
  return a.length === b.length && a.every((annotation, index) => {
    const other = b[index]
    return other !== undefined
      && annotation.id === other.id
      && annotation.path === other.path
      && annotation.startLine === other.startLine
      && annotation.endLine === other.endLine
      && annotation.startColumn === other.startColumn
      && annotation.endColumn === other.endColumn
      && annotation.text === other.text
      && annotation.instruction === other.instruction
      && annotation.status === other.status
  })
}

/** A comparable absolute path key: resolved, lowercased on case-insensitive Windows. */
function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * File-selection service: records the selected-file set and the edit-marker
 * set on a session, reads the latest of each back for the prompt context, and
 * completes pending markers when the model's filesystem tools touch their file.
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
    // A root-scope listener receives every agent's scoped `tools/result`
    // (scopeTarget admits ancestors), so one standing observer completes
    // markers across every session.
    ctx.on('tools/result', (exec, result) => { this.completeMarkers(exec, result) })
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

  /**
   * Record a new edit-marker set. Identical consecutive sets are not re-logged.
   * @param session - the session whose markers changed.
   * @param annotations - the complete marker list (order preserved).
   */
  annotate(session: Session, annotations: readonly FileAnnotation[]): void {
    const snapshot = annotations.map(annotation => ({ ...annotation }))
    if (sameAnnotations(this.latestAnnotations(session), snapshot)) return
    session.append('file/annotation', { annotations: snapshot })
  }

  /**
   * The latest recorded edit-marker set, or an empty list before any.
   * @param session - the session to read.
   * @returns the markers in recorded order.
   */
  latestAnnotations(session: Session): FileAnnotation[] {
    for (const event of [...session.events].reverse()) {
      if (event.type === 'file/annotation') return event.data.annotations.map(a => ({ ...a }))
    }
    return []
  }

  /**
   * Complete every pending marker whose file the model just wrote or edited.
   * A successful `write`/`edit` tool result on a marked file means the model
   * acted on that file, so its pending markers flip to `done` and the updated
   * set is re-logged. Only the file matters here — a range-precise match needs
   * a diff of the write, which the marker's own `text` snapshot already lets a
   * future pass reconstruct; the tag color only needs the file-level signal.
   * @param exec - the completed tool execution.
   * @param result - its outcome.
   */
  private completeMarkers(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (result.isError) return
    if (exec.name !== 'write' && exec.name !== 'edit') return
    const arguments_ = exec.arguments
    if (typeof arguments_ !== 'object' || arguments_ === null) return
    const filePath = (arguments_ as { file_path?: unknown }).file_path
    if (typeof filePath !== 'string' || filePath.trim() === '') return
    const agent = exec.agent
    if (agent === undefined) return
    const cwd = agent.session.header.cwd
    const target = pathKey(isAbsolute(filePath) ? filePath : resolve(cwd ?? process.cwd(), filePath))
    const annotations = this.latestAnnotations(agent.session)
    const touched = new Set(annotations.filter(a => a.status === 'pending' && pathKey(a.path) === target).map(a => a.id))
    if (touched.size === 0) return
    this.annotate(agent.session, annotations.map(a => touched.has(a.id) ? { ...a, status: 'done' as const } : a))
  }

  /** Render the latest selection and pending markers for one assembly; empty contributes nothing. */
  private render(assemble: AssembleContext): string {
    const session = assemble.agent?.session
    if (session === undefined) return ''
    const files = this.latest(session)
    const pending = this.latestAnnotations(session).filter(a => a.status === 'pending')
    if (files.length === 0 && pending.length === 0) return ''
    const sections: string[] = []
    if (files.length > 0) {
      sections.push(`Selected files (user-marked in the file tree):\n${files.map(path => `- ${path}`).join('\n')}`)
    }
    if (pending.length > 0) {
      sections.push(`File edit markers (user-marked text regions with instructions — perform each, then edit the file):\n${
        pending.map((a) => {
          const range = a.startLine === a.endLine
            ? `line ${a.startLine}`
            : `lines ${a.startLine}-${a.endLine}`
          return `- ${a.path} (${range}): "${a.text}"\n  instruction: ${a.instruction}`
        }).join('\n')
      }`)
    }
    return sections.join('\n\n')
  }
}

export default FileSelection
