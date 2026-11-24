import { describe, expect, it } from 'vitest'
import { Gate, Merged, NoteJson, type Timing } from '../data/schema.ts'
import { STEP_ENTRY_BASIS, buildRecipeBundle, checkAt, personaWords } from './bundle.ts'
import { canonicalJson } from './canon.ts'
import { runGate } from './gate.ts'
import { SOURCE, syntheticRecipe } from './gate.fixture.ts'
import { sha256Hex } from './sha256.ts'

const rec = syntheticRecipe()
const g = runGate({ recipeId: 'syn', pageBytes: new Uint8Array([1]), scan: rec.scan, files: rec.files as never })
const gate = Gate.parse({ ...g.gate, at: '2026-11-25T00:00:00.000Z' })
const merged = Merged.parse(g.artifacts.json.get('merged.json'))
const notes = [...g.artifacts.json.entries()].filter(([k]) => k.startsWith('notes/')).map(([, v]) => NoteJson.parse(v))
const input = (timing?: Timing) => ({
  id: 'syn', title: rec.scribe.title, source: SOURCE, gate, gateSha256: sha256Hex(new TextEncoder().encode(canonicalJson(gate))), merged, steps: rec.scribe.steps, notes, timing,
})

describe('checkAt (R36)', () => {
  it('defaults to step entry with the stated basis', () => {
    expect(checkAt('n', 'any text')).toEqual({ ok: true, value: { seconds: 0, source: 'step-entry', basis: STEP_ENTRY_BASIS } })
  })
  it('accepts a cited time whose basis is in the step text, refuses one that is not', () => {
    const t: Timing = [{ noteId: 'n', seconds: 600, source: 'cited', basis: 'boil it' }]
    expect(checkAt('n', 'and boil it till it Looks', t)).toEqual({ ok: true, value: { seconds: 600, source: 'cited', basis: 'boil it' } })
    const r = checkAt('n', 'and simmer gently', t)
    expect(r.ok).toBe(false)
  })
})

describe('buildRecipeBundle (R37)', () => {
  it('builds a valid bundle with provenance and a step-entry check time on every note, never "cook"', () => {
    const r = buildRecipeBundle(input())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bundle.notes.length).toBe(2)
    for (const n of r.bundle.notes) {
      expect(n.checkAt.source).toBe('step-entry')
      expect(n.provenance).toMatchObject({ institution: 'Wellcome Collection', shelfmark: 'MS.1810', page: 'p.23', credit: 'Wellcome Collection' })
      expect(n.reveal).toBe('traced left to right from the ink')
    }
    expect(JSON.stringify(r.bundle)).not.toContain('"cook"')
    expect(r.bundle.transcription.disagreements.length).toBe(1)
  })
  it('refuses the recipe when timing.json cites a basis that is not in the step', () => {
    const r = buildRecipeBundle(input([{ noteId: 'full-ripe', seconds: 60, source: 'cited', basis: 'one minute' }]))
    expect(r.ok).toBe(false)
  })
  it('the generated JSON never contains "she" or "her"', () => {
    const r = buildRecipeBundle(input())
    if (!r.ok) throw new Error(r.error)
    expect(personaWords(canonicalJson(r.bundle))).toEqual([])
    expect(personaWords(canonicalJson(gate))).toEqual([])
    expect(personaWords('the writer; her hand; She wrote; there; where')).toEqual(['her', 'She'])
  })
})
