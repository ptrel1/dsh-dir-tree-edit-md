import { describe, expect, it } from 'vitest'
import type { FileTreeEntry, FileTreeGitStatus } from '@deepseek-ai/dsh-client-runtime/client'
import type { FilterTreeNode } from '../src/client/search.ts'
import { buildFilteredTree } from '../src/client/search.ts'

const match = (
  path: string,
  kind: 'file' | 'directory' = 'file',
  gitStatus?: FileTreeGitStatus,
): FileTreeEntry => ({
  name: path.split(/[/\\]/).pop()!,
  path,
  kind,
  hidden: false,
  ...(gitStatus === undefined ? {} : { gitStatus }),
})

const names = (node: FilterTreeNode): string[] => node.children.map(child => child.name)

describe('buildFilteredTree', () => {
  it('synthesizes ancestor chains under a virtual root', () => {
    const tree = buildFilteredTree('/proj', [match('/proj/src/deep/c.txt')])
    expect(tree.path).toBe('/proj')
    expect(tree.synthesized).toBe(true)
    expect(names(tree)).toEqual(['src'])

    const src = tree.children[0]!
    expect(src).toMatchObject({ path: '/proj/src', kind: 'directory', synthesized: true, parent: tree })
    expect(src.gitStatus).toBeUndefined()
    expect(names(src)).toEqual(['deep'])

    const deep = src.children[0]!
    expect(deep).toMatchObject({ path: '/proj/src/deep', synthesized: true })
    expect(names(deep)).toEqual(['c.txt'])

    const leaf = deep.children[0]!
    expect(leaf).toMatchObject({ path: '/proj/src/deep/c.txt', kind: 'file', synthesized: false, parent: deep })
    expect(leaf.children).toEqual([])
  })

  it('replaces a synthesized placeholder with its real match, keeping gathered children', () => {
    const tree = buildFilteredTree('/proj', [
      match('/proj/src/deep/c.txt'),
      match('/proj/src', 'directory', 'modified'),
    ])
    const src = tree.children[0]!
    expect(src.synthesized).toBe(false)
    expect(src.kind).toBe('directory')
    expect(src.gitStatus).toBe('modified')
    // The deeper match arrived first and still hangs off the real node.
    expect(names(src)).toEqual(['deep'])
    expect(src.children[0]!.children[0]!.path).toBe('/proj/src/deep/c.txt')
  })

  it('merges matches sharing a prefix and preserves each real match once', () => {
    const tree = buildFilteredTree('/proj', [
      match('/proj/dir/inner.txt'),
      match('/proj/dir', 'directory'),
      match('/proj/dir/other.txt', 'file', 'added'),
    ])
    const dir = tree.children[0]!
    expect(dir).toMatchObject({ path: '/proj/dir', synthesized: false })
    expect(names(dir)).toEqual(['inner.txt', 'other.txt'])
  })

  it('sorts directories first, then by locale order', () => {
    const tree = buildFilteredTree('/proj', [
      match('/proj/z.txt'),
      match('/proj/b.txt'),
      match('/proj/m-dir/sub.txt'),
      match('/proj/a-dir/x.txt'),
    ])
    expect(names(tree)).toEqual(['a-dir', 'm-dir', 'b.txt', 'z.txt'])
    expect(names(tree.children[0]!)).toEqual(['x.txt'])
  })

  it('handles backslash separators in match paths', () => {
    const tree = buildFilteredTree('/proj', [match('/proj/src\\deep\\c.txt')])
    const src = tree.children[0]!
    expect(src.path).toBe('/proj/src')
    expect(src.children[0]!.path).toBe('/proj/src/deep')
    expect(src.children[0]!.children[0]!.path).toBe('/proj/src/deep/c.txt')
  })

  it('keeps node paths in the root separator flavor (Windows wire paths survive)', () => {
    const tree = buildFilteredTree('C:\\ws', [match('C:\\ws\\src\\deep\\c.txt')])
    const src = tree.children[0]!
    expect(src.path).toBe('C:\\ws\\src')
    expect(src.children[0]!.path).toBe('C:\\ws\\src\\deep')
    expect(src.children[0]!.children[0]!.path).toBe('C:\\ws\\src\\deep\\c.txt')
  })

  it('drops matches outside the search root', () => {
    const tree = buildFilteredTree('/proj', [match('/elsewhere/x.txt'), match('/proj/a.txt')])
    expect(names(tree)).toEqual(['a.txt'])
    expect(buildFilteredTree('/proj', [match('/proj')]).children).toEqual([])
  })

  it('keeps git ink on real matches only', () => {
    const tree = buildFilteredTree('/proj', [match('/proj/src/a.txt', 'file', 'untracked')])
    expect(tree.children[0]!.gitStatus).toBeUndefined()
    expect(tree.children[0]!.children[0]!.gitStatus).toBe('untracked')
  })
})
