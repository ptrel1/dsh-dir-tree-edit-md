/** Behavior of the local file-tree backend over real temporary directory trees. */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { FileTreeError } from '@deepseek-ai/dsh-host-file-tree'
import type { FileTree } from '@deepseek-ai/dsh-host-file-tree'
import LocalFileTree, { type Config } from '../src/index.ts'

/** Full backend config with the shipped defaults, spread over per-test overrides. */
function config(overrides: Partial<Config> = {}): Config {
  return {
    maxEntries: 1000,
    graceMs: 5000,
    gitStatusMaxBytes: 8 * 1024 * 1024,
    gitStatusIncludeIgnored: false,
    gitStatusTimeoutMs: 8000,
    usePolling: false,
    watchPollIntervalMs: 500,
    watchIgnored: ['**/node_modules/**', '**/.git/**', '**/.pnpm-store/**'],
    watchDepth: undefined,
    ...overrides,
  }
}

/** Default scan output: a modified file, an untracked dotfile, and a modified file nested under `dir`. */
const DEFAULT_GIT_OUTPUT = 'M  workspace/a.txt\0?? workspace/.hidden.txt\0M  workspace/dir/b.txt\0'

function gitHandle(stdout: string, exitCode = 0, lossy = false, collected: SubprocessHandle['collected'] = {
  stdout: { readFrom: () => ({ text: stdout, nextOffset: 0, lossy }) },
  stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
}): SubprocessHandle {
  return {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected,
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

let repoRoot: string
let root: string
let ctx: Context
let tree: FileTree
let dispose: () => Promise<void>
let gitBehavior: (spec: SubprocessSpawnSpec) => SubprocessHandle

beforeAll(async () => {
  // The git work tree (contains `.git`) is a PARENT of the listed workspace, so
  // the listing itself is free of `.git` while `findGitRoot` still finds one.
  repoRoot = await mkdtemp(join(tmpdir(), 'dsh-ft-repo-'))
  await mkdir(join(repoRoot, '.git'))
  root = join(repoRoot, 'workspace')
  await mkdir(root)
  await mkdir(join(root, 'dir'))
  await writeFile(join(root, 'a.txt'), 'a')
  await writeFile(join(root, '.hidden.txt'), 'h')
  await writeFile(join(root, 'dir', 'b.txt'), 'b')
  await symlink(join(root, 'dir'), join(root, 'linked'), 'junction')
  await symlink(join(root, 'gone'), join(root, 'broken'), 'junction')
  try {
    await symlink(join(root, 'a.txt'), join(root, 'file-link'))
  } catch {
    // Windows denies unprivileged file symlinks; the file-link row only feeds
    // the POSIX lane's coverage of the symlink-to-file arm.
  }

  ctx = new Context()
  ctx.provide('subprocess', { spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => gitBehavior(spec) })
  const fiber = ctx.plugin(LocalFileTree)
  await fiber.await()
  tree = ctx.get('fileTree')!
  dispose = () => fiber.dispose()
  gitBehavior = () => gitHandle(DEFAULT_GIT_OUTPUT)
})

afterAll(async () => {
  await dispose()
  await rm(repoRoot, { recursive: true, force: true })
})

describe('LocalFileTree', () => {
  it('lists files and directories name-sorted with per-file git status', async () => {
    const listing = await tree.listDir(root)
    expect(listing.path).toBe(root)
    const names = listing.entries.map(entry => entry.name)
    expect(names).not.toContain('broken')
    expect([...names].sort()).toEqual(names)
    const hidden = listing.entries.find(entry => entry.name === '.hidden.txt')!
    expect(hidden.kind).toBe('file')
    expect(hidden.hidden).toBe(true)
    expect(hidden.gitStatus).toBe('untracked')
    const a = listing.entries.find(entry => entry.name === 'a.txt')!
    expect(a.kind).toBe('file')
    expect(a.gitStatus).toBe('modified')
    const dir = listing.entries.find(entry => entry.name === 'dir')!
    expect(dir.kind).toBe('directory')
    expect(dir.gitStatus).toBe('modified')
    const linked = listing.entries.find(entry => entry.name === 'linked')!
    expect(linked.gitStatus).toBeUndefined()
    expect(listing.truncated).toBe(false)
  })

  it('cuts a level at maxEntries and flags the cut', async () => {
    const bounded = new Context()
    bounded.provide('subprocess', { spawn: () => gitHandle('') })
    const fiber = bounded.plugin(LocalFileTree, config({ maxEntries: 2 }))
    await fiber.await()
    try {
      const cut = await bounded.get('fileTree')!.listDir(root)
      expect(cut.entries.map(entry => entry.name)).toEqual(['.hidden.txt', 'a.txt'])
      expect(cut.truncated).toBe(true)
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects a path that is not fully qualified', async () => {
    await expect(tree.listDir('relative/path')).rejects.toThrow('not a fully qualified path')
    const failure = await tree.listDir('relative/path').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FileTreeError)
    expect((failure as FileTreeError).code).toBe('tree-unreadable')
  })

  it('stops the scan with the caller: an aborted signal rejects with its own reason', async () => {
    const gone = new AbortController()
    gone.abort(new Error('caller left'))
    await expect(tree.listDir(root, gone.signal)).rejects.toThrow('caller left')
    // A live signal leaves a normal listing untouched.
    const live = new AbortController()
    const complete = await tree.listDir(root, live.signal)
    expect(complete.entries.length).toBeGreaterThan(0)
  })

  it('reports an unreadable directory as tree-unreadable', async () => {
    const failure = await tree.listDir(join(root, 'no-such-dir')).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FileTreeError)
    expect((failure as FileTreeError).code).toBe('tree-unreadable')
  })

  it('arms a polling watcher when configured', async () => {
    const polling = new Context()
    polling.provide('subprocess', { spawn: () => gitHandle('') })
    const fiber = polling.plugin(LocalFileTree, config({ usePolling: true }))
    await fiber.await()
    try {
      const listing = await polling.get('fileTree')!.listDir(root)
      expect(listing.entries.length).toBeGreaterThan(0)
    } finally {
      await fiber.dispose()
    }
  })

  it('omits --ignored from the git-status scan by default and opts in on config', async () => {
    let seen: SubprocessSpawnSpec | undefined
    gitBehavior = (spec) => { seen = spec; return gitHandle('') }
    await tree.listDir(root)
    expect(seen!.argv).not.toContain('--ignored')

    const withIgnored = new Context()
    withIgnored.provide('subprocess', { spawn: (spec: SubprocessSpawnSpec) => { seen = spec; return gitHandle('') } })
    const fiber = withIgnored.plugin(LocalFileTree, config({ gitStatusIncludeIgnored: true }))
    await fiber.await()
    try {
      await withIgnored.get('fileTree')!.listDir(root)
      expect(seen!.argv).toContain('--ignored')
    } finally {
      await fiber.dispose()
    }
  })

  it('bounds one git-status read with the deadline: a stalled git still settles the listing', async () => {
    const slow = new Context()
    slow.provide('subprocess', { spawn: () => ({ ...gitHandle(''), done: new Promise(() => {}) }) })
    const fiber = slow.plugin(LocalFileTree, config({ gitStatusTimeoutMs: 60 }))
    await fiber.await()
    try {
      const listing = await slow.get('fileTree')!.listDir(root)
      expect(listing.entries.find(entry => entry.name === 'a.txt')).toBeTruthy()
      expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()
    } finally {
      await fiber.dispose()
    }
  })

  it('shares one git spawn across concurrent listings of the same repo', async () => {
    let spawns = 0
    let settle: ((outcome: { exitCode: number; signal: null }) => void) | undefined
    gitBehavior = () => {
      spawns += 1
      return { ...gitHandle(''), done: new Promise(resolve => { settle = resolve }) }
    }
    const first = tree.listDir(root)
    await new Promise(resolve => setTimeout(resolve, 50))
    const second = tree.listDir(root)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(spawns).toBe(1)
    settle?.({ exitCode: 0, signal: null })
    const [one, two] = await Promise.all([first, second])
    expect(one.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()
    expect(two.entries.length).toBe(one.entries.length)
    gitBehavior = () => gitHandle(DEFAULT_GIT_OUTPUT)
  })

  it('degrades to no coloring when git is unavailable or overflows', async () => {
    gitBehavior = () => { throw new Error('no git') }
    let listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()

    gitBehavior = () => ({ ...gitHandle(''), done: Promise.reject(new Error('boom')) })
    listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()

    gitBehavior = () => gitHandle('', 128)
    listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()

    gitBehavior = () => gitHandle('', 0, true)
    listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()

    gitBehavior = () => gitHandle('', 0, false, {})
    listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'a.txt')!.gitStatus).toBeUndefined()

    gitBehavior = () => gitHandle(DEFAULT_GIT_OUTPUT)
  })

  it('follows directory symlinks and skips broken links', async () => {
    const listing = await tree.listDir(root)
    expect(listing.entries.find(entry => entry.name === 'linked')!.kind).toBe('directory')
    expect(listing.entries.map(entry => entry.name)).not.toContain('broken')
    const fileLink = listing.entries.find(entry => entry.name === 'file-link')
    if (fileLink !== undefined) {
      expect(fileLink.kind).toBe('file')
    }
  })

  it('emits filetree/change when a watched root changes', async () => {
    const watchRoot = await mkdtemp(join(tmpdir(), 'dsh-ft-watch-'))
    const watchCtx = new Context()
    watchCtx.provide('subprocess', { spawn: () => gitHandle('') })
    const fiber = watchCtx.plugin(LocalFileTree)
    await fiber.await()
    const events: Array<{ root: string; paths: readonly string[] }> = []
    const off = watchCtx.on('filetree/change', (watchedRoot, paths) => { events.push({ root: watchedRoot, paths }) })
    try {
      await watchCtx.get('fileTree')!.listDir(watchRoot)
      await writeFile(join(watchRoot, 'new.txt'), 'n')
      const deadline = Date.now() + 5000
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.root).toBe(watchRoot)
      expect(events[0]!.paths).toContain(join(watchRoot, 'new.txt'))
    } finally {
      off()
      await fiber.dispose()
      await rm(watchRoot, { recursive: true, force: true })
    }
  })
})
