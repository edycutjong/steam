// R1.4: the ingest core runs in Node, vitest and a browser worker, so it may not touch any of them.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dir = new URL('./', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f))

/** Comments removed, so prose may name a word. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}
/** String and template literal contents removed (data text may use the words; code may not). */
function noStrings(src: string): string {
  return src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
}

const BANNED_IMPORT = /(?:from|import)\s*\(?\s*['"]node:/
const BANNED_GLOBALS = /\b(?:window|document|process|Buffer|fetch)\b/

describe('src/ingest purity', () => {
  it('has non-test source files to check once the pipeline exists', () => {
    expect(files.length).toBeGreaterThan(0)
  })
  for (const f of files) {
    it(`${f} imports no node: module and names no host global`, () => {
      const c = code(readFileSync(new URL(f, dir), 'utf8'))
      expect(c, 'node: import').not.toMatch(BANNED_IMPORT)
      expect(noStrings(c), 'host global').not.toMatch(BANNED_GLOBALS)
    })
  }
  it('the detector itself catches each banned form', () => {
    expect(BANNED_IMPORT.test(`import fs from 'node:fs'`)).toBe(true)
    for (const g of ['window', 'document', 'process', 'Buffer', 'fetch'])
      expect(BANNED_GLOBALS.test(`const x = ${g}.y`)).toBe(true)
    expect(BANNED_GLOBALS.test('const fetched = 1')).toBe(false)
  })
})
