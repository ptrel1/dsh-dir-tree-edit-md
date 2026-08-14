import { describe, expect, it } from 'vitest'
import { createFileTreeStore } from '../src/client/store.ts'
import type { FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

const listing = (path: string): FileTreeListing => ({ path, entries: [], truncated: false })

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
    expect(store.getSnapshot()).toEqual({ children: {}, expanded: [], selection: [], failed: {} })
  })

  it('deduplicates expanded paths', () => {
    const store = createFileTreeStore().create()
    store.actions.setExpanded('/r', true)
    store.actions.setExpanded('/r', true)
    expect(store.getSnapshot().expanded).toEqual(['/r'])
  })
})
