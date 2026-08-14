// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { FileTreeEntry, FileTreeListing, FileTreeSearchResult, SessionId, SessionListState, SessionSummary, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileTreeProps } from '../src/client/FileTree.tsx'
import { FileTree } from '../src/client/FileTree.tsx'
import { createFileTreeStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (id: string) => id as SessionId
const summary = (id: string, cwd: string): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt: 0, cwd,
})
const sessionState = (cwd: string | undefined): SessionListState => {
  const items = cwd === undefined ? [] : [summary('s1', cwd)]
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    current: cwd === undefined ? undefined : sid('s1'),
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

const emptyWorkspaces: WorkspaceListState = {
  items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  recentWorkspaceId: undefined,
}

const entry = (name: string, kind: 'file' | 'directory', gitStatus?: FileTreeEntry['gitStatus']): FileTreeEntry => ({
  name, path: `/proj/${name}`, kind, hidden: name.startsWith('.'),
  ...(gitStatus === undefined ? {} : { gitStatus }),
})

const rootListing = (): FileTreeListing => ({
  path: '/proj',
  entries: [
    entry('dir', 'directory'),
    entry('a.txt', 'file', 'modified'),
    entry('b.txt', 'file'),
  ],
  truncated: false,
})

const dirListing = (): FileTreeListing => ({
  path: '/proj/dir',
  entries: [entry('inner.txt', 'file', 'added')],
  truncated: false,
})

const emptySearch = async (root: string): Promise<FileTreeSearchResult> => ({ path: root, matches: [], truncated: false })

/** Typed search stub factory: the match literals get their FileTreeEntry context. */
const searchStub = (matches: FileTreeEntry[], truncated = false) =>
  vi.fn(async (root: string): Promise<FileTreeSearchResult> => ({ path: root, matches, truncated }))

function mount(overrides: Partial<FileTreeProps> = {}) {
  const store = createFileTreeStore().create()
  const listDir = vi.fn(async (path: string) => (path === '/proj' ? rootListing() : dirListing()))
  // The returned mock must be the one the component calls: honor the override.
  const searchEntries = overrides.searchEntries ?? vi.fn(emptySearch)
  const openPath = vi.fn(async () => {})
  const copyPath = vi.fn()
  const selectFiles = vi.fn()
  const props: FileTreeProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(sessionState('/proj')),
    useWorkspaces: hook(emptyWorkspaces),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    listDir,
    searchEntries,
    openPath,
    copyPath,
    selectFiles,
    useFileTreeChange: hook({ revision: 0 }),
    t: makeTranslate(zh, commonZh),
    ...overrides,
  }
  const view = render(<FileTree {...props} />)
  return { view, props, store, listDir, searchEntries, openPath, copyPath, selectFiles }
}

describe('FileTree', () => {
  it('renders the empty state without a workspace cwd', () => {
    const view = render(<FileTree {...mount().props} useSessions={hook(sessionState(undefined))} />)
    expect(screen.getByText('未选择工作区')).toBeTruthy()
    view.unmount()
  })

  it('lists the root, marks git status, and expands a directory lazily', async () => {
    const { listDir } = mount()
    await waitFor(() => { expect(listDir).toHaveBeenCalledWith('/proj', expect.anything()) })
    expect(screen.getByText('a.txt')).toBeTruthy()
    expect(screen.getByText('dir')).toBeTruthy()

    fireEvent.click(screen.getByText('dir'))
    await waitFor(() => { expect(listDir).toHaveBeenCalledWith('/proj/dir', expect.anything()) })
    expect(screen.getByText('inner.txt')).toBeTruthy()
  })

  it('renders a retry row when a listing fails and recovers on click', async () => {
    let calls = 0
    const flaky = vi.fn(async () => {
      // Both mount effects list the root; fail them, then succeed on retry.
      if (++calls <= 2) throw new Error('boom')
      return rootListing()
    })
    mount({ listDir: flaky })
    const retry = await waitFor(() => screen.getByText('加载失败，点击重试'))
    expect(screen.queryByText('a.txt')).toBeNull()

    fireEvent.click(retry)
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    expect(screen.queryByText('加载失败，点击重试')).toBeNull()
  })

  it('toggles selection and syncs it to the host', async () => {
    const { selectFiles } = mount()
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    fireEvent.click(screen.getByText('a.txt'))
    expect(selectFiles).toHaveBeenCalledWith(sid('s1'), ['/proj/a.txt'])
    fireEvent.click(screen.getByText('a.txt'))
    expect(selectFiles).toHaveBeenLastCalledWith(sid('s1'), [])
  })

  it('opens and copies paths through the injected face', async () => {
    const { openPath, copyPath } = mount()
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    // The hover-revealed actions stay in the DOM (display:none); click the first row's pair.
    const copies = screen.getAllByText('复制')
    const opens = screen.getAllByText('打开')
    fireEvent.click(copies[0]!)
    expect(copyPath).toHaveBeenCalledWith('/proj/dir')
    fireEvent.click(opens[0]!)
    expect(openPath).toHaveBeenCalledWith('/proj/dir')
  })
})

describe('FileTree search', () => {
  it('renders the search box above the plain tree', async () => {
    mount()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
  })

  it('debounces a query and filters in place with synthesized ancestors', async () => {
    const { searchEntries } = mount({
      searchEntries: searchStub([{ name: 'c.txt', path: '/proj/src/deep/c.txt', kind: 'file', hidden: false }]),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'c' } })
    // The plain tree hides immediately; the pending state shows while debouncing.
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByText('a.txt')).toBeNull()

    await waitFor(() => { expect(searchEntries).toHaveBeenCalledWith('/proj', 'c', expect.anything()) })
    await waitFor(() => { expect(screen.getByText('c.txt')).toBeTruthy() })
    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByText('deep')).toBeTruthy()
    // Synthesized ancestors carry no git ink and stay auto-expanded.
    expect(screen.getByText('src').closest('button')!.className).not.toMatch(/git_/)
    expect(screen.getAllByText('▾')).toHaveLength(2)
    expect(screen.queryByText('a.txt')).toBeNull()
    expect(screen.queryByText('dir')).toBeNull()
  })

  it('collapses rapid keystrokes into one superseded request', async () => {
    const { searchEntries } = mount()
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'a' } })
    fireEvent.change(box, { target: { value: 'ab' } })
    await waitFor(() => { expect(searchEntries).toHaveBeenCalledWith('/proj', 'ab', expect.anything()) })
    expect(searchEntries).toHaveBeenCalledTimes(1)
  })

  it('renders the no-matches notice', async () => {
    mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    await waitFor(() => { expect(screen.getByText('未找到匹配项')).toBeTruthy() })
    expect(screen.queryByText('a.txt')).toBeNull()
  })

  it('renders the truncation notice under a capped result', async () => {
    mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }], true),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    await waitFor(() => { expect(screen.getByText('结果过多，已截断')).toBeTruthy() })
    expect(screen.getByText('a.txt')).toBeTruthy()
  })

  it('restores the plain tree on Escape and on the clear button', async () => {
    mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }]),
    })
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'a' } })
    await waitFor(() => { expect(screen.queryByText('b.txt')).toBeNull() })

    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => { expect(screen.getByText('b.txt')).toBeTruthy() })

    fireEvent.change(box, { target: { value: 'a' } })
    await waitFor(() => { expect(screen.queryByText('b.txt')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    await waitFor(() => { expect(screen.getByText('b.txt')).toBeTruthy() })
  })

  it('guards Escape during IME composition', async () => {
    mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }]),
    })
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'a' } })
    await waitFor(() => { expect(screen.queryByText('b.txt')).toBeNull() })

    fireEvent.compositionStart(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    // Composition-committed Escape must not clear the active filter.
    expect(screen.queryByText('b.txt')).toBeNull()
    fireEvent.compositionEnd(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => { expect(screen.getByText('b.txt')).toBeTruthy() })
  })

  it('reveals a matched directory in the plain tree on click', async () => {
    const { listDir, store } = mount({
      searchEntries: searchStub([
        { name: 'dir', path: '/proj/dir', kind: 'directory', hidden: false },
        { name: 'inner.txt', path: '/proj/dir/inner.txt', kind: 'file', hidden: false, gitStatus: 'added' },
      ]),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'i' } })
    await waitFor(() => { expect(screen.getByText('inner.txt')).toBeTruthy() })
    // One merged 'dir' row (real match hosting its deeper match as a child).
    expect(screen.getAllByText('dir')).toHaveLength(1)

    fireEvent.click(screen.getByText('dir'))
    await waitFor(() => { expect(listDir).toHaveBeenCalledWith('/proj/dir', expect.anything()) })
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('')
    expect(store.getSnapshot().expanded).toEqual(['/proj/dir'])
    // The plain tree now hosts the revealed directory with its real child.
    await waitFor(() => { expect(screen.getByText('inner.txt')).toBeTruthy() })
  })

  it('toggles selection on a matched file row', async () => {
    const { selectFiles } = mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false, gitStatus: 'modified' }]),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    fireEvent.click(screen.getByText('a.txt'))
    expect(selectFiles).toHaveBeenCalledWith(sid('s1'), ['/proj/a.txt'])
  })

  it('re-runs the settled search when the host reports a change', async () => {
    const { view, props, searchEntries } = mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }]),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    await waitFor(() => { expect(searchEntries).toHaveBeenCalledTimes(1) })

    view.rerender(<FileTree {...props} useFileTreeChange={hook({ revision: 1 })} />)
    await waitFor(() => { expect(searchEntries).toHaveBeenCalledTimes(2) })
    expect(searchEntries).toHaveBeenLastCalledWith('/proj', 'a', expect.anything())
  })

  it('keeps the query across a workspace switch and re-searches the new root', async () => {
    const { view, props, searchEntries } = mount({
      searchEntries: searchStub([{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }]),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    await waitFor(() => { expect(searchEntries).toHaveBeenCalledWith('/proj', 'a', expect.anything()) })

    view.rerender(<FileTree {...props} useSessions={hook(sessionState('/other'))} />)
    await waitFor(() => { expect(searchEntries).toHaveBeenLastCalledWith('/other', 'a', expect.anything()) })
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('a')
  })

  it('renders a retry affordance when the search fails and recovers on click', async () => {
    let calls = 0
    mount({
      searchEntries: vi.fn(async (root: string): Promise<FileTreeSearchResult> => {
        if (++calls === 1) throw new Error('boom')
        return { path: root, matches: [{ name: 'a.txt', path: '/proj/a.txt', kind: 'file', hidden: false }], truncated: false }
      }),
    })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    const retry = await waitFor(() => screen.getByText('搜索失败，点击重试'))
    fireEvent.click(retry)
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    expect(screen.queryByText('搜索失败，点击重试')).toBeNull()
  })
})
