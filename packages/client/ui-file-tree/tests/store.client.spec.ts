import { describe, expect, it } from 'vitest'
import { createFileTreeStore } from '../src/client/store.ts'
import type { FileTreeEntry, FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

const listing = (path: string): FileTreeListing => ({ path, entries: [], truncated: false })

const entry = (name: string, kind: 'file' | 'directory'): FileTreeEntry => ({
  name, path: `/proj/${name}`, kind, hidden: false,
})

describe('createFileTreeStore', () => {
  it('sets and clears children, expanded, and selection', () => {
    const store = createFileTreeStore().create()
    store.actions.setChildren('/r', listing('/r'))
    expect(store.getSnapshot().children['/r']).toEqual(listing('/r'))

    store.actions.setExpanded('/r', true)
    expect(store.getSnapshot().expanded).toEqual(['/r'])
    store.actions.setExpanded('/r', false)
    expect(store.getSnapshot().expanded).toEqual([])

    store.actions.toggleSelection('/a')
    store.actions.toggleSelection('/b')
    store.actions.toggleSelection('/a')
    expect(store.getSnapshot().selection).toEqual(['/b'])

    store.actions.setFailed('/r', true)
    expect(store.getSnapshot().failed).toEqual({ '/r': true })

    store.actions.clearChildren()
    expect(store.getSnapshot().children).toEqual({})
    store.actions.clearExpanded()
    store.actions.clearSelection()
    store.actions.clearFailed()
    store.actions.clearAnnotations()
    store.actions.clearMarked()
    store.actions.setEditor(null)
    expect(store.getSnapshot()).toEqual({
      children: {}, expanded: [], selection: [], failed: {}, search: null, annotations: {}, marked: [], editor: null,
    })
  })

  it('accumulates opened-file paths onto the mark rail (idempotent, open order)', () => {
    const store = createFileTreeStore().create()
    expect(store.getSnapshot().marked).toEqual([])

    store.actions.markOpened('/proj/a.ts')
    store.actions.markOpened('/proj/b.ts')
    store.actions.markOpened('/proj/a.ts')
    expect(store.getSnapshot().marked).toEqual(['/proj/a.ts', '/proj/b.ts'])

    store.actions.clearMarked()
    expect(store.getSnapshot().marked).toEqual([])
  })

  it('closeMarked drops the file from the rail and clears every marker it carries', () => {
    const store = createFileTreeStore().create()
    const a = { id: 'a1', path: '/proj/a.ts', startLine: 1, endLine: 1, startColumn: 1, endColumn: 5, text: 'const', instruction: 'refactor', status: 'pending' as const }
    const b = { id: 'b1', path: '/proj/b.ts', startLine: 3, endLine: 3, startColumn: 1, endColumn: 6, text: 'let', instruction: 'rename', status: 'done' as const }
    store.actions.markOpened('/proj/a.ts')
    store.actions.markOpened('/proj/b.ts')
    store.actions.addAnnotation('/proj/a.ts', a)
    store.actions.addAnnotation('/proj/b.ts', b)
    store.actions.setEditor({ path: '/proj/a.ts', text: 'const x = 1', truncated: false, failed: false })

    // Closing the file being edited clears its markers, its rail tag, and the editor.
    store.actions.closeMarked('/proj/a.ts')
    expect(store.getSnapshot().marked).toEqual(['/proj/b.ts'])
    expect(store.getSnapshot().annotations['/proj/a.ts']).toBeUndefined()
    expect(store.getSnapshot().annotations['/proj/b.ts']).toEqual([b])
    expect(store.getSnapshot().editor).toBeNull()

    // Closing the last file empties the rail and leaves no markers behind.
    store.actions.closeMarked('/proj/b.ts')
    expect(store.getSnapshot().marked).toEqual([])
    expect(store.getSnapshot().annotations).toEqual({})
    expect(store.getSnapshot().editor).toBeNull()
  })

  it('deduplicates expanded paths', () => {
    const store = createFileTreeStore().create()
    store.actions.setExpanded('/r', true)
    store.actions.setExpanded('/r', true)
    expect(store.getSnapshot().expanded).toEqual(['/r'])
  })

  it('sets and clears the search slice', () => {
    const store = createFileTreeStore().create()
    expect(store.getSnapshot().search).toBeNull()

    const search = { query: 'a', matches: [entry('a.txt', 'file')], truncated: true, failed: false }
    store.actions.setSearch(search)
    expect(store.getSnapshot().search).toEqual(search)

    store.actions.clearSearch()
    expect(store.getSnapshot().search).toBeNull()
  })

  it('adds, removes, and merges annotation statuses', () => {
    const store = createFileTreeStore().create()
    const marker = {
      id: 'm1', path: '/proj/a.ts', startLine: 1, endLine: 1, startColumn: 1, endColumn: 5,
      text: 'const', instruction: 'refactor', status: 'pending' as const,
    }
    store.actions.addAnnotation('/proj/a.ts', marker)
    expect(store.getSnapshot().annotations['/proj/a.ts']).toEqual([marker])

    store.actions.mergeAnnotationStatuses([{ ...marker, status: 'done' }])
    expect(store.getSnapshot().annotations['/proj/a.ts']?.[0]?.status).toBe('done')

    store.actions.removeAnnotation('/proj/a.ts', 'm1')
    expect(store.getSnapshot().annotations['/proj/a.ts']).toEqual([])
  })
})
