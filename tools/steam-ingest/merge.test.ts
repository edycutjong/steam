import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { syntheticRecipe } from '../../src/ingest/gate.fixture.ts'
import { parseTranscription } from '../../src/ingest/merge.ts'
import { mergeCmd } from './merge.ts'

const dir = mkdtempSync(join(tmpdir(), 'steam-merge-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const rec = syntheticRecipe()
mkdirSync(join(dir, 'agent'))
for (const f of ['lines.json', 'agent/scribe.json', 'agent/second.json']) writeFileSync(join(dir, f), rec.files[f]!)

describe('merge (R15.7)', () => {
  it('writes transcription.md when absent, with the strict header and the disagreement marker', () => {
    expect(mergeCmd(dir)).toEqual({ wrote: true, equal: true })
    const md = readFileSync(join(dir, 'transcription.md'), 'utf8')
    const p = parseTranscription(md)
    expect(p.ok).toBe(true)
    expect(md).toContain('L01: Let your quinces †[be|bee]\n')
  })
  it('leaves an existing file unchanged and says whether it equals the fresh merge', () => {
    expect(mergeCmd(dir)).toEqual({ wrote: false, equal: true })
    const p = join(dir, 'transcription.md')
    const edited = readFileSync(p, 'utf8').replace('†[be|bee]', 'be')
    writeFileSync(p, edited)
    expect(mergeCmd(dir)).toEqual({ wrote: false, equal: false })
    expect(readFileSync(p, 'utf8')).toBe(edited)
  })
})
