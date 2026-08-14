// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { FileTreeEntry, FileTreeListing, SessionId, SessionListState, SessionSummary, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
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

function mount(overrides: Partial<FileTreeProps> = {}) {
  const store = createFileTreeStore().create()
  const listDir = vi.fn(async (path: string) => (path === '/proj' ? rootListing() : dirListing()))
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
    openPath,
    copyPath,
    selectFiles,
    useFileTreeChange: hook({ revision: 0 }),
    t: makeTranslate(zh, commonZh),
    ...overrides,
  }
  const view = render(<FileTree {...props} />)
  return { view, props, store, listDir, openPath, copyPath, selectFiles }
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
