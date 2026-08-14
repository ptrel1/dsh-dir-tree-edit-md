/** Listing helper behavior: path fencing, the bounded window, and abort-racing. */

import { describe, expect, it } from 'vitest'
import {
  asError, boundedInsert, fullyQualified, globToRegExp, messageOf, nameMatches, pathIgnored, raceAbort,
} from '../src/listing.ts'
import type { ListingCandidate } from '../src/listing.ts'

function candidate(name: string): ListingCandidate {
  return { name, isDirectory: false, isSymbolicLink: false }
}

describe('fullyQualified', () => {
  it('accepts POSIX-absolute and rejects relative paths', () => {
    expect(fullyQualified('/abs', 'linux')).toBe(true)
    expect(fullyQualified('rel', 'linux')).toBe(false)
    expect(fullyQualified('', 'linux')).toBe(false)
  })

  it('accepts only drive-qualified or complete-UNC Windows paths', () => {
    expect(fullyQualified('C:\\repo', 'win32')).toBe(true)
    expect(fullyQualified('C:/repo', 'win32')).toBe(true)
    expect(fullyQualified('\\\\server\\share\\repo', 'win32')).toBe(true)
    expect(fullyQualified('\\rooted', 'win32')).toBe(false)
    expect(fullyQualified('/rooted', 'win32')).toBe(false)
    expect(fullyQualified('\\\\server', 'win32')).toBe(false)
    expect(fullyQualified('rel', 'win32')).toBe(false)
  })
})

describe('boundedInsert', () => {
  it('keeps the window name-sorted without eviction under the bound', () => {
    const window: ListingCandidate[] = []
    expect(boundedInsert(window, candidate('b'), 3)).toBe(false)
    expect(boundedInsert(window, candidate('a'), 3)).toBe(false)
    expect(boundedInsert(window, candidate('c'), 3)).toBe(false)
    expect(window.map(c => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('evicts the name-largest candidate and reports the eviction', () => {
    const window: ListingCandidate[] = []
    boundedInsert(window, candidate('b'), 2)
    boundedInsert(window, candidate('a'), 2)
    expect(boundedInsert(window, candidate('c'), 2)).toBe(true)
    expect(window.map(c => c.name)).toEqual(['a', 'b'])
  })

  it('rejects a candidate at or beyond the full-window tail in one comparison', () => {
    const window: ListingCandidate[] = []
    boundedInsert(window, candidate('a'), 2)
    boundedInsert(window, candidate('b'), 2)
    expect(boundedInsert(window, candidate('c'), 2)).toBe(true)
    expect(boundedInsert(window, candidate('b'), 2)).toBe(true)
    expect(window.map(c => c.name)).toEqual(['a', 'b'])
  })

  it('evicts through the slow path when the candidate lands inside the window', () => {
    const window: ListingCandidate[] = []
    boundedInsert(window, candidate('b'), 2)
    boundedInsert(window, candidate('c'), 2)
    expect(boundedInsert(window, candidate('a'), 2)).toBe(true)
    expect(window.map(c => c.name)).toEqual(['a', 'b'])
  })
})

describe('raceAbort', () => {
  it('passes settled operations through untouched', async () => {
    await expect(raceAbort(Promise.resolve('ok'), undefined)).resolves.toBe('ok')
    const live = new AbortController()
    await expect(raceAbort(Promise.resolve('ok'), live.signal)).resolves.toBe('ok')
    await expect(raceAbort(Promise.reject(new Error('raw')), live.signal)).rejects.toThrow('raw')
  })

  it('wins on an already-aborted signal and swallows the abandoned settlement', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('left'))
    await expect(raceAbort(Promise.reject(new Error('late')), aborted.signal)).rejects.toThrow('left')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('wins when the signal aborts while the operation is pending', async () => {
    const controller = new AbortController()
    const pending = raceAbort(new Promise(() => {}), controller.signal)
    controller.abort(new Error('late leave'))
    await expect(pending).rejects.toThrow('late leave')
  })
})

describe('globToRegExp', () => {
  const match = (glob: string, path: string): boolean => globToRegExp(glob).test(path)

  it('matches a directory name at any depth, the directory itself, and its subtree', () => {
    expect(match('**/node_modules/**', 'D:/repo/node_modules/x/y')).toBe(true)
    expect(match('**/node_modules/**', 'D:/repo/a/node_modules')).toBe(true)
    expect(match('**/node_modules/**', '/home/u/repo/node_modules/x')).toBe(true)
    expect(match('**/node_modules/**', 'D:/repo/node_modules')).toBe(true)
    expect(match('**/node_modules/**', 'D:/repo/node_modules/x')).toBe(true)
  })

  it('respects segment boundaries and skips unrelated paths', () => {
    expect(match('**/node_modules/**', 'D:/repo/x/node_modules_backup/y')).toBe(false)
    expect(match('**/node_modules/**', 'D:/repo/x/node-modules/y')).toBe(false)
    expect(match('**/node_modules/**', 'D:/repo/x/src/index.ts')).toBe(false)
  })

  it('supports * within a segment, at any depth', () => {
    expect(match('**/*.log', 'D:/repo/a/debug.log')).toBe(true)
    expect(match('**/*.log', 'D:/repo/a/debug.log.old')).toBe(false)
    expect(match('*.tmp', 'D:/repo/scratch.tmp')).toBe(true)
    expect(match('*.tmp', 'D:/repo/dir/scratch.tmp')).toBe(true)
  })

  it('treats a pattern without a trailing /** as the whole subtree', () => {
    expect(match('**/.cache', 'D:/repo/.cache/a/b')).toBe(true)
    expect(match('**/.cache', 'D:/repo/.cache')).toBe(true)
    expect(match('**/.cache', 'D:/repo/x/.cache2')).toBe(false)
  })

  it('matches mid-pattern ** spans', () => {
    expect(match('packages/**/tests/**', 'D:/repo/packages/a/tests/x.ts')).toBe(true)
    expect(match('packages/**/tests/**', 'D:/repo/packages/tests/x.ts')).toBe(true)
    expect(match('packages/**/tests/**', 'D:/repo/packages/a/src/x.ts')).toBe(false)
  })

  it('matches backslash-form Windows paths once slash-normalized (the caller normalizes)', () => {
    const slash = (path: string): string => path.replace(/\\/g, '/')
    expect(match('**/node_modules/**', slash('D:\\repo\\node_modules\\x\\y'))).toBe(true)
    expect(match('**/node_modules/**', slash('D:\\repo\\src\\x.ts'))).toBe(false)
  })
})

describe('asError / messageOf', () => {
  it('normalizes thrown values', () => {
    const error = new Error('boom')
    expect(asError(error)).toBe(error)
    expect(asError('text')).toBeInstanceOf(Error)
    expect(messageOf(error)).toBe('boom')
    expect(messageOf('text')).toBe('text')
  })
})

describe('nameMatches', () => {
  it('matches case-insensitive substrings against a pre-lowered needle', () => {
    expect(nameMatches('store.ts', 'store')).toBe(true)
    expect(nameMatches('Store.ts', 'store')).toBe(true)
    expect(nameMatches('redstore.ts', 'store')).toBe(true)
    expect(nameMatches('index.ts', 'store')).toBe(false)
    expect(nameMatches('s', '')).toBe(true)
  })
})

describe('pathIgnored', () => {
  const matchers = [globToRegExp('**/node_modules/**'), globToRegExp('**/.git/**'), globToRegExp('**/.pnpm-store/**')]

  it('blocks an ignored directory at any depth, itself included', () => {
    expect(pathIgnored('node_modules', matchers)).toBe(true)
    expect(pathIgnored('node_modules/dep/a.js', matchers)).toBe(true)
    expect(pathIgnored('packages/x/node_modules/a.js', matchers)).toBe(true)
    expect(pathIgnored('.git/config', matchers)).toBe(true)
    expect(pathIgnored('packages/.pnpm-store/v3', matchers)).toBe(true)
  })

  it('normalizes backslash-form Windows paths', () => {
    expect(pathIgnored('packages\\x\\node_modules\\a.js', matchers)).toBe(true)
    expect(pathIgnored('packages\\x\\src\\a.ts', matchers)).toBe(false)
  })

  it('passes unrelated paths', () => {
    expect(pathIgnored('src/index.ts', matchers)).toBe(false)
    expect(pathIgnored('packages/node_modules_backup/a.ts', matchers)).toBe(false)
    expect(pathIgnored('', matchers)).toBe(false)
  })
})
