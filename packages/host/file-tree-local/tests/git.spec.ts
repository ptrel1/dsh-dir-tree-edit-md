/** Git helper behavior: porcelain folding, -z parsing, and `.git` discovery. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aggregateDirStatus, entryExists, findGitRoot, parseGitStatus, statusForCode } from '../src/git.ts'

describe('statusForCode', () => {
  it('folds the classic porcelain codes and returns undefined for unmodified', () => {
    expect(statusForCode('??')).toBe('untracked')
    expect(statusForCode('!!')).toBe('ignored')
    expect(statusForCode(' D')).toBe('deleted')
    expect(statusForCode('D ')).toBe('deleted')
    expect(statusForCode('A ')).toBe('added')
    expect(statusForCode(' A')).toBe('added')
    expect(statusForCode('C ')).toBe('added')
    expect(statusForCode('M ')).toBe('modified')
    expect(statusForCode(' M')).toBe('modified')
    expect(statusForCode('MM')).toBe('modified')
    expect(statusForCode('R ')).toBe('modified')
    expect(statusForCode(' U')).toBe('modified')
    expect(statusForCode('UU')).toBe('modified')
    expect(statusForCode('  ')).toBeUndefined()
  })
})

describe('parseGitStatus', () => {
  it('maps every ordinary field and skips malformed or unmodified ones', () => {
    const parsed = parseGitStatus('M  a.txt\0?? b.txt\0!! c.txt\0D  d.txt\0A  e.txt\0   untouched.txt\0garbage\0')
    expect(parsed.get('a.txt')).toBe('modified')
    expect(parsed.get('b.txt')).toBe('untracked')
    expect(parsed.get('c.txt')).toBe('ignored')
    expect(parsed.get('d.txt')).toBe('deleted')
    expect(parsed.get('e.txt')).toBe('added')
    expect(parsed.has('untouched.txt')).toBe(false)
    expect(parsed.has('garbage')).toBe(false)
    expect(parsed.size).toBe(5)
  })

  it('keeps both paths of a rename/copy record under the folded status', () => {
    const parsed = parseGitStatus('R  old.txt\0new.txt\0')
    expect(parsed.get('old.txt')).toBe('modified')
    expect(parsed.get('new.txt')).toBe('modified')
    expect(parsed.size).toBe(2)
  })

  it('returns an empty map for empty input', () => {
    expect(parseGitStatus('').size).toBe(0)
  })

  it('skips a field with an empty path and a rename whose destination is missing', () => {
    expect(parseGitStatus('M  \0').size).toBe(0)
    const missingDestination = parseGitStatus('R  old.txt\0')
    expect(missingDestination.get('old.txt')).toBe('modified')
    expect(missingDestination.size).toBe(1)
  })
})

describe('aggregateDirStatus', () => {
  it('marks every ancestor directory of a statused path', () => {
    const byDir = aggregateDirStatus(new Map([['a/b/c/file.txt', 'modified']]))
    expect(byDir.get('a')).toBe('modified')
    expect(byDir.get('a/b')).toBe('modified')
    expect(byDir.get('a/b/c')).toBe('modified')
    expect(byDir.size).toBe(3)
  })

  it('normalizes backslash-form keys defensively', () => {
    const byDir = aggregateDirStatus(new Map([['a\\b\\c.txt', 'modified']]))
    expect(byDir.get('a')).toBe('modified')
    expect(byDir.get('a/b')).toBe('modified')
  })

  it('keeps the highest-ranked status when descendants differ', () => {
    const byDir = aggregateDirStatus(new Map([
      ['x/one.txt', 'untracked'],
      ['x/y/two.txt', 'added'],
      ['x/y/z/three.txt', 'modified'],
    ]))
    expect(byDir.get('x')).toBe('modified')
    expect(byDir.get('x/y')).toBe('modified')
    expect(byDir.get('x/y/z')).toBe('modified')
  })

  it('prefers untracked over ignored in a mixed directory', () => {
    const byDir = aggregateDirStatus(new Map([
      ['m/ignored-dir/', 'ignored'],
      ['m/loose.txt', 'untracked'],
    ]))
    expect(byDir.get('m')).toBe('untracked')
  })

  it('colors a collapsed directory record itself', () => {
    const byDir = aggregateDirStatus(new Map([
      ['fresh/', 'untracked'],
      ['fresh/sub.txt', 'untracked'],
    ]))
    expect(byDir.get('fresh')).toBe('untracked')
  })

  it('returns an empty map for an empty input', () => {
    expect(aggregateDirStatus(new Map()).size).toBe(0)
  })
})

describe('findGitRoot', () => {
  it('walks up to the nearest ancestor containing .git', async () => {
    const exists = async (path: string): Promise<boolean> => path === join('C:', 'repo', '.git') || path === join('C:', 'repo')
    expect(await findGitRoot(join('C:', 'repo', 'src', 'deep'), exists)).toBe(join('C:', 'repo'))
  })

  it('returns undefined when no ancestor contains .git', async () => {
    expect(await findGitRoot(join('C:', 'a', 'b'), async () => false)).toBeUndefined()
  })
})

describe('entryExists', () => {
  let dir: string
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-ft-git-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('probes real filesystem existence', async () => {
    const file = join(dir, 'present.txt')
    await writeFile(file, 'x')
    expect(await entryExists(file)).toBe(true)
    expect(await entryExists(join(dir, 'absent'))).toBe(false)
  })
})
