/** Host read helpers: language hinting, binary sniffing, and BOM-stripped decoding. */

import { describe, expect, it } from 'vitest'
import { decodeText, langFromPath, sniffBinary } from '../src/read.ts'

describe('langFromPath', () => {
  it('maps common extensions to shiki language ids', () => {
    expect(langFromPath('/proj/src/a.ts')).toBe('ts')
    expect(langFromPath('C:\\proj\\a.py')).toBe('py')
    expect(langFromPath('README.md')).toBe('md')
    expect(langFromPath('conf.yml')).toBe('yaml')
  })

  it('returns undefined for unknown or missing extensions', () => {
    expect(langFromPath('a.unknownext')).toBeUndefined()
    expect(langFromPath('.gitignore')).toBeUndefined()
    expect(langFromPath('trailingdot.')).toBeUndefined()
  })
})

describe('sniffBinary', () => {
  it('flags NUL bytes as binary', () => {
    expect(sniffBinary(Buffer.from([0x61, 0x00, 0x62]))).toBe(true)
    expect(sniffBinary(Buffer.from('plain text'))).toBe(false)
    expect(sniffBinary(new Uint8Array(0))).toBe(false)
  })
})

describe('decodeText', () => {
  it('strips a UTF-8 BOM and decodes', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF])
    const text = Buffer.from('hello', 'utf8')
    expect(decodeText(Buffer.concat([bom, text]))).toBe('hello')
    expect(decodeText(text)).toBe('hello')
  })
})
