/**
 * The file-tree edit-marker dock occupant: the rightmost layout column, whose
 * width is driven discretely through the injected `setDock` (0 / DOCK_RAIL /
 * DOCK_EXPANDED) from the shared store state. With no editor open the column
 * collapses to a narrow vertical rail of one filename tag per opened file;
 * clicking a tag reopens that file's editor. With an editor open the column
 * shows a tag strip plus the highlighted, selectable file body. Drag-selecting
 * text in the editor opens the annotation box; submitting records a marker the
 * model is asked to carry out. Renders into the frame's dock track — no portal,
 * no covering overlay: opening the panel pushes the center column.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  grammarLoadCount, highlightLines, subscribeGrammarLoaded, IconCloseFill14, IconLoadingOutline16,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileAnnotation, FileAnnotationStatus } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only, from the client face: imports the layout SlotMap + Context.layout
// merges (bare-path host entry exposes neither) and the DockMode contract.
export type DockMode = 'closed' | 'rail' | 'expanded'
import type { createFileTreeStore } from './store.ts'
import { basename, selectionRange } from './marks.ts'
import { openEditor, type ReadFile } from './editor.ts'
import type { FileTreeKey } from './locales.ts'
import css from './MarkPanel.module.css'

/** The dock entry's inject face: the wire read + the layout dock driver. */
export interface MarkPanelInjected {
  /** Host read face for opening a file from its tag. */
  readFile: ReadFile
  /** Drive the dock column width from the mark state (closed / rail / expanded). */
  setDockMode: (mode: DockMode) => void
}

/** The panel's store + locale face, plus the wire and dock drivers. */
export type MarkPanelProps =
  PropsStore<ReturnType<typeof createFileTreeStore>>
  & PropsLocale<'filetree'>
  & MarkPanelInjected

/** One marker's character range within a single line (0-based, end-exclusive). */
interface LineMarkerRange {
  start: number
  end: number
  id: string
  status: FileAnnotationStatus
}

/** One highlighted text run (highlighted or plain) with an optional marker wrap. */
interface LineSegment {
  text: string
  color?: string
  markerId?: string
  markerStatus?: FileAnnotationStatus
}

/** Split one line's token runs by the marker ranges that overlap it. */
function lineSegments(lineText: string, runs: HighlightSpan[] | undefined, markers: readonly LineMarkerRange[]): LineSegment[] {
  const base: HighlightSpan[] = runs ?? [{ text: lineText, style: {} }]
  const sorted = markers.slice().sort((a, b) => a.start - b.start)
  const segments: LineSegment[] = []
  let offset = 0
  for (const run of base) {
    const runStart = offset
    const runEnd = offset + run.text.length
    offset = runEnd
    let cursor = runStart
    for (const marker of sorted) {
      if (marker.end <= runStart || marker.start >= runEnd) continue
      const start = Math.max(marker.start, runStart)
      const end = Math.min(marker.end, runEnd)
      if (start > cursor) {
        segments.push({
          text: run.text.slice(cursor - runStart, start - runStart),
          ...(run.style.color === undefined ? {} : { color: run.style.color }),
        })
      }
      segments.push({
        text: run.text.slice(start - runStart, end - runStart),
        ...(run.style.color === undefined ? {} : { color: run.style.color }),
        markerId: marker.id,
        markerStatus: marker.status,
      })
      cursor = end
    }
    if (cursor < runEnd) {
      segments.push({
        text: run.text.slice(cursor - runStart),
        ...(run.style.color === undefined ? {} : { color: run.style.color }),
      })
    }
  }
  return segments.filter(s => s.text.length > 0)
}

/** Marker ranges that fall on one line. */
function markersOnLine(annotations: readonly FileAnnotation[], lineIndex: number, lineLength: number): LineMarkerRange[] {
  const ranges: LineMarkerRange[] = []
  for (const annotation of annotations) {
    const first = annotation.startLine - 1
    const last = annotation.endLine - 1
    if (lineIndex < first || lineIndex > last) continue
    ranges.push({
      start: lineIndex === first ? annotation.startColumn - 1 : 0,
      end: lineIndex === last ? annotation.endColumn - 1 : lineLength,
      id: annotation.id,
      status: annotation.status,
    })
  }
  return ranges
}

/** One line of the editor: a gutter number plus highlighted/marked content. */
function EditorLine({ lineText, lineIndex, runs, markers, highlightId }: {
  lineText: string
  lineIndex: number
  runs: HighlightSpan[] | undefined
  markers: readonly LineMarkerRange[]
  /** Marker id to visually ring (set by a marker-list click), or null. */
  highlightId: string | null
}) {
  const segments = lineSegments(lineText, runs, markers)
  return (
    <div className={css.line} data-line={lineIndex + 1}>
      <span className={css.gutter} aria-hidden="true">{lineIndex + 1}</span>
      <span className={css.content} data-content>
        {segments.map((segment, index) => segment.markerId === undefined
          ? <span key={index} style={segment.color === undefined ? undefined : { color: segment.color }}>{segment.text}</span>
          : (
            <mark
              key={index}
              className={clsx(
                segment.markerStatus === 'done' ? css.markerDone : css.markerPending,
                segment.markerId === highlightId && css.markerHighlighted,
              )}
              style={segment.color === undefined ? undefined : { color: segment.color }}
            >
              {segment.text}
            </mark>
          ))}
      </span>
    </div>
  )
}

/** The open-file editor body: highlighted source with selectable text or markdown preview. */
function Editor({ text, truncated, language, failed, loading, annotations, onMark, onDelete, t, viewMode }: {
  text: string
  truncated: boolean
  language: string | undefined
  failed: boolean
  loading: boolean
  annotations: readonly FileAnnotation[]
  onMark: (range: ReturnType<typeof selectionRange>) => void
  onDelete: (id: string) => void
  t: (key: FileTreeKey) => string
  viewMode: 'preview' | 'source' | 'split'
}) {
  const lines = useMemo(() => text.split('\n'), [text])
  // Re-render when a lazy grammar finishes loading (same contract as CodeBlock).
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const highlighted = useMemo(() => highlightLines(text, language), [text, language, loaded])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // The marker-list row whose marker is currently located in the editor (null =
  // none). Clicking a row scrolls the body to the marker and rings its text;
  // clicking the same row again clears the ring.
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const focusMarker = useCallback((id: string, startLine: number) => {
    setHighlightId(prev => (prev === id ? null : id))
    const line = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${startLine}"]`)
    if (line !== undefined && line !== null) line.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  if (failed) {
    return <div className={css.editorError}>{t('editor.failed')}</div>
  }

  if (loading) {
    return (
      <div className={css.editorBody}>
        <div className={css.editorLoading} role="status" aria-label={t('editor.loading')}>
          <IconLoadingOutline16 className={css.loadingIcon} />
          <span>{t('editor.loading')}</span>
        </div>
      </div>
    )
  }

  const renderSourceLines = () => (
    <>
      <div ref={bodyRef} className={css.lines} onMouseUp={() => {
        if (bodyRef.current === null) return
        onMark(selectionRange(bodyRef.current, lines))
      }}>
        {lines.map((lineText, index) => (
          <EditorLine
            key={index}
            lineText={lineText}
            lineIndex={index}
            runs={highlighted?.[index]}
            markers={markersOnLine(annotations, index, lineText.length)}
            highlightId={highlightId}
          />
        ))}
      </div>
      {truncated && <div className={css.truncated}>{t('editor.truncated')}</div>}
      {annotations.length > 0 && (
        <div className={css.markerList}>
          {annotations.map(annotation => (
            <div
              key={annotation.id}
              className={clsx(css.markerItem, annotation.id === highlightId && css.markerItemActive)}
              data-active={annotation.id === highlightId || undefined}
              onClick={() => { focusMarker(annotation.id, annotation.startLine) }}
            >
              <span className={clsx(css.markerDot, annotation.status === 'done' ? css.markerDone : css.markerPending)} />
              <span className={css.markerItemText}>
                {annotation.startLine === annotation.endLine ? `L${annotation.startLine}` : `L${annotation.startLine}-${annotation.endLine}`}
                {' '}{annotation.instruction}
              </span>
              <button
                type="button"
                className={css.deleteButton}
                aria-label={t('action.deleteMarker')}
                onClick={(e) => { e.stopPropagation(); onDelete(annotation.id) }}
              >
                <IconCloseFill14 />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )

  const renderMarkdownPreview = () => (
    <div className={css.markdownPreview}>
      <MarkdownText text={text} />
      {truncated && <div className={css.truncated}>{t('editor.truncated')}</div>}
    </div>
  )

  return (
    <div className={css.editorBody}>
      {viewMode === 'preview' ? (
        renderMarkdownPreview()
      ) : viewMode === 'split' ? (
        <div className={css.splitContainer}>
          <div className={css.splitEditor}>{renderSourceLines()}</div>
          <div className={css.splitPreview}><MarkdownText text={text} /></div>
        </div>
      ) : (
        renderSourceLines()
      )}
    </div>
  )
}

/** The dock column occupant: collapsed tag rail, or tag strip + editor. */
export function MarkPanel({ useStore, actions, readFile, setDockMode, t }: MarkPanelProps) {
  const marked = useStore(s => s.marked)
  const annotations = useStore(s => s.annotations)
  const editor = useStore(s => s.editor)
  const [pending, setPending] = useState<{
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    text: string
  } | null>(null)
  const [instruction, setInstruction] = useState('')

  const open = useCallback((path: string) => { openEditor(actions, readFile, path) }, [actions, readFile])

  // The tag ✕: drop the file from the rail and clear every marker it carries.
  const closeMarked = useCallback((path: string) => { actions.closeMarked(path) }, [actions])

  // The dock's width follows the mark state: closed with nothing opened, the
  // narrow rail once files are marked but no editor is open, else the expanded
  // editor. The boolean dep keeps the effect from re-firing on every editor
  // content update (mode writes are idempotent anyway).
  useEffect(() => {
    if (marked.length === 0) setDockMode('closed')
    else setDockMode(editor === null ? 'rail' : 'expanded')
  }, [marked.length, editor === null, setDockMode])

  // Closing the editor drops a half-typed annotation (the box only belongs to
  // an open editor; re-opening must not resurrect it).
  useEffect(() => {
    if (editor !== null) return
    setPending(null)
    setInstruction('')
  }, [editor === null])

  const submitMarker = useCallback(() => {
    if (pending === null || editor === null || instruction.trim() === '') return
    const annotation: FileAnnotation = {
      id: crypto.randomUUID(),
      path: editor.path,
      startLine: pending.startLine + 1,
      endLine: pending.endLine + 1,
      startColumn: pending.startColumn + 1,
      endColumn: pending.endColumn + 1,
      text: pending.text,
      instruction: instruction.trim(),
      status: 'pending',
    }
    actions.addAnnotation(editor.path, annotation)
    setPending(null)
    setInstruction('')
  }, [pending, editor, instruction, actions])

  if (marked.length === 0 && editor === null) return null

  // Completion of a file's marker set: all done, any pending, or neutral when
  // the file was opened but nothing marked yet.
  const tagStatus = (path: string): FileAnnotationStatus | undefined => {
    const list = annotations[path]
    if (list === undefined || list.length === 0) return undefined
    return list.every(a => a.status === 'done') ? 'done' : 'pending'
  }

  // Collapsed rail: one filename tag per opened file; clicking reopens. The ✕
  // (aria 关闭文件) sits inside the tag corner and clears every marker the file
  // carries — stopPropagation keeps it from also reopening the file.
  if (editor === null) {
    return (
      <div className={css.rail} role="complementary" aria-label={t('panel.label')}>
        {marked.map((path) => {
          const status = tagStatus(path)
          return (
            <button
              key={path}
              type="button"
              title={path}
              className={clsx(css.tag, css.railTag, status === 'done' && css.tagDone, status === 'pending' && css.tagPending)}
              onClick={() => { open(path) }}
            >
              <span className={css.tagName}>{basename(path)}</span>
              {status !== undefined && <span className={css.tagCount}>{annotations[path]?.length ?? 0}</span>}
              <button
                type="button"
                className={css.tagClose}
                aria-label={t('action.closeFile')}
                title={t('action.closeFile')}
                onClick={(e) => { e.stopPropagation(); closeMarked(path) }}
              >
                <IconCloseFill14 />
              </button>
            </button>
          )
        })}
      </div>
    )
  }

  // View mode state for markdown/text files. Markdown defaults to preview, others to source.
  const isMd = editor?.path.endsWith('.md') || editor?.path.endsWith('.markdown') || editor?.language === 'markdown'
  const [viewMode, setViewMode] = useState<'preview' | 'source' | 'split'>('source')

  useEffect(() => {
    if (editor === null) return
    const md = editor.path.endsWith('.md') || editor.path.endsWith('.markdown') || editor.language === 'markdown'
    setViewMode(md ? 'preview' : 'source')
  }, [editor?.path, editor?.language])

  // Expanded: tag strip (clicking switches the editor) + the editor body.
  return (
    <div className={css.panel} role="complementary" aria-label={t('panel.label')}>
      {marked.length > 0 && (
        <div className={css.tagRail}>
          {marked.map((path) => {
            const status = tagStatus(path)
            const current = path === editor.path
            return (
              <button
                key={path}
                type="button"
                title={path}
                aria-current={current || undefined}
                className={clsx(css.tag, current && css.tagCurrent, status === 'done' && css.tagDone, status === 'pending' && css.tagPending)}
                onClick={() => { open(path) }}
              >
                <span className={css.tagName}>{basename(path)}</span>
                {status !== undefined && <span className={css.tagCount}>{annotations[path]?.length ?? 0}</span>}
                <button
                  type="button"
                  className={css.tagClose}
                  aria-label={t('action.closeFile')}
                  title={t('action.closeFile')}
                  onClick={(e) => { e.stopPropagation(); closeMarked(path) }}
                >
                  <IconCloseFill14 />
                </button>
              </button>
            )
          })}
        </div>
      )}
      <div className={css.editor}>
        <div className={css.editorHeader}>
          <span className={css.editorTitle}>{basename(editor.path)}</span>
          {isMd && (
            <div className={css.modeSwitch} role="group" aria-label="View mode">
              <button
                type="button"
                className={clsx(css.modeButton, viewMode === 'preview' && css.modeButtonActive)}
                onClick={() => { setViewMode('preview') }}
              >
                {t('editor.viewMode.preview')}
              </button>
              <button
                type="button"
                className={clsx(css.modeButton, viewMode === 'source' && css.modeButtonActive)}
                onClick={() => { setViewMode('source') }}
              >
                {t('editor.viewMode.source')}
              </button>
              <button
                type="button"
                className={clsx(css.modeButton, viewMode === 'split' && css.modeButtonActive)}
                onClick={() => { setViewMode('split') }}
              >
                {t('editor.viewMode.split')}
              </button>
            </div>
          )}
          <button type="button" className={css.closeButton} aria-label={t('action.closeEditor')} onClick={() => { actions.setEditor(null) }}>
            <IconCloseFill14 />
          </button>
        </div>
        <Editor
          text={editor.text}
          truncated={editor.truncated}
          language={editor.language}
          failed={editor.failed}
          loading={editor.loading === true}
          annotations={annotations[editor.path] ?? []}
          onMark={(range) => {
            if (range === null) return
            setPending({
              startLine: range.startLine,
              startColumn: range.startColumn,
              endLine: range.endLine,
              endColumn: range.endColumn,
              text: range.text,
            })
          }}
          onDelete={(id) => { actions.removeAnnotation(editor.path, id) }}
          t={t}
          viewMode={isMd ? viewMode : 'source'}
        />
      </div>
      {pending !== null && (
        <div className={css.annotationBox}>
          <div className={css.annotationSnippet}>{pending.text.length > 160 ? `${pending.text.slice(0, 160)}…` : pending.text}</div>
          <textarea
            className={css.annotationInput}
            autoFocus
            rows={2}
            placeholder={t('editor.annotationPlaceholder')}
            value={instruction}
            onChange={(e) => { setInstruction(e.target.value) }}
          />
          <div className={css.annotationActions}>
            <button type="button" className={css.cancelButton} onClick={() => { setPending(null); setInstruction('') }}>
              {t('action.cancel')}
            </button>
            <button type="button" className={css.markButton} disabled={instruction.trim() === ''} onClick={submitMarker}>
              {t('action.mark')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
