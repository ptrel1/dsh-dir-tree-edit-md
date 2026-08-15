/** Contract behavior the seam itself owns: registration identity and typed failures. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileTree, FileTreeError } from '../src/index.ts'
import type { FileTreeListing, FileTreeReadResult, FileTreeSearchResult } from '../src/index.ts'

/** Minimal concrete backend: all a subclass owes the abstract class is listDir(), search(), and readFile(). */
class StubFileTree extends FileTree {
  async listDir(): Promise<FileTreeListing> {
    return { path: '/x', entries: [], truncated: false }
  }

  async search(): Promise<FileTreeSearchResult> {
    return { path: '/x', matches: [], truncated: false }
  }

  async readFile(): Promise<FileTreeReadResult> {
    return { path: '/x', text: '', truncated: false }
  }
}

describe('FileTree seam', () => {
  it('registers a subclass as ctx.fileTree and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubFileTree)
    await fiber.await()
    expect(ctx.get('fileTree')).toBeInstanceOf(StubFileTree)
    await fiber.dispose()
    expect(ctx.get('fileTree')).toBeUndefined()
  })

  it('carries the business code and subject path on FileTreeError', () => {
    const failure = new FileTreeError('tree-unreadable', '/x', '/x is not listable')
    expect(failure.name).toBe('FileTreeError')
    expect(failure.code).toBe('tree-unreadable')
    expect(failure.path).toBe('/x')
    expect(failure.message).toContain('not listable')
    expect(failure).toBeInstanceOf(Error)
  })
})
