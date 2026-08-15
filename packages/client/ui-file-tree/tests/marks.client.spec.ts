/** Client edit-marker helpers: the text-file gate and basename splitting. */

import { describe, expect, it } from 'vitest'
import { basename, isTextFile } from '../src/client/marks.ts'

describe('isTextFile', () => {
  it('accepts common text extensions', () => {
    expect(isTextFile('a.ts')).toBe(true)
    expect(isTextFile('a.py')).toBe(true)
    expect(isTextFile('README.md')).toBe(true)
    expect(isTextFile('conf.yml')).toBe(true)
    expect(isTextFile('notes.txt')).toBe(true)
  })

  it('accepts known basenames without an extension', () => {
    expect(isTextFile('Dockerfile')).toBe(true)
    expect(isTextFile('Makefile')).toBe(true)
    expect(isTextFile('.gitignore')).toBe(true)
  })

  it('rejects binary-ish extensions', () => {
    expect(isTextFile('photo.png')).toBe(false)
    expect(isTextFile('archive.zip')).toBe(false)
    expect(isTextFile('movie.mp4')).toBe(false)
  })
})

describe('basename', () => {
  it('splits both separator conventions', () => {
    expect(basename('/proj/src/a.ts')).toBe('a.ts')
    expect(basename('C:\\proj\\src\\a.ts')).toBe('a.ts')
    expect(basename('a.ts')).toBe('a.ts')
  })
})
