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
    expect(mergeCmd(dir)).toEqual({ wrote: true, equal: true, state: 'missing' })
    const md = readFileSync(join(dir, 'transcription.md'), 'utf8')
    const p = parseTranscription(md)
    expect(p.ok).toBe(true)
    expect(md).toContain('L01: Let your quinces †[be|bee]\n')
  })
  it('leaves an existing file unchanged and says whether it equals the fresh merge', () => {
    expect(mergeCmd(dir)).toEqual({ wrote: false, equal: true, state: 'current' })
    const p = join(dir, 'transcription.md')
    const edited = readFileSync(p, 'utf8').replace('†[be|bee]', 'be')
    writeFileSync(p, edited)
    expect(mergeCmd(dir)).toEqual({ wrote: false, equal: false, state: 'current' })
    expect(readFileSync(p, 'utf8')).toBe(edited)
  })
  it('regenerates a stale file that carries no revision, and leaves a stale revised file alone (turn 24)', () => {
    const p = join(dir, 'transcription.md')
    writeFileSync(p, '')
    mergeCmd(dir)
    const fresh = readFileSync(p, 'utf8')
    const stale = fresh.replace(/readers: [0-9a-f]{64}:/, `readers: ${'e'.repeat(64)}:`)
    writeFileSync(p, stale)
    expect(mergeCmd(dir)).toEqual({ wrote: true, equal: true, state: 'regenerated' })
    expect(readFileSync(p, 'utf8')).toBe(fresh)
    const revised = stale.replace('†[be|bee]', 'bee')
    writeFileSync(p, revised)
    expect(mergeCmd(dir)).toEqual({ wrote: false, equal: false, state: 'revised' })
    expect(readFileSync(p, 'utf8')).toBe(revised)
  })
})
