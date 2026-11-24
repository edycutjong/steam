import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Gate, Merged, NoteJson, type Timing } from '../data/schema.ts'
import { RecipeBundle } from '../data/schema.ts'
import { STEP_ENTRY_BASIS, buildRecipeBundle, verifyRegion, checkAt, personaWords } from './bundle.ts'
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
  id: 'syn', title: rec.scribe.title, source: SOURCE, frame: { width: rec.scan.width, height: rec.scan.height }, deskew: { deg: 1.6, applied: true }, review: { reviewedBy: 'Test Reviewer', reviewedAt: '2026-11-25' }, gate, gateSha256: sha256Hex(new TextEncoder().encode(canonicalJson(gate))), merged, steps: rec.scribe.steps, notes, timing,
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

describe('bundle fields (R21.1 to R21.3, R3.5, R3.6)', () => {
  const built = () => {
    const r = buildRecipeBundle(input())
    if (!r.ok) throw new Error(r.error)
    return r.bundle
  }
  it('writes notes[].verifyBox from verifyRegion, source.frame from the lines frame, and review verbatim', () => {
    const b = built()
    for (const n of b.notes) expect(n.verifyBox).toEqual(verifyRegion({ pageBox: n.pageBox, frame: b.source.frame!, deskewDeg: 1.6, deskewApplied: true }).box)
    expect(b.source.frame).toMatchObject({ width: rec.scan.width, height: rec.scan.height })
    expect(b.review).toEqual({ reviewedBy: 'Test Reviewer', reviewedAt: '2026-11-25' })
  })
  it('refuses a bundle without source.canvas, without source.frame, with a note lacking verifyBox, or without review', () => {
    const b = JSON.parse(JSON.stringify(built()))
    const bad = (f: (x: any) => void) => { const c = JSON.parse(JSON.stringify(b)); f(c); return RecipeBundle.safeParse(c).success } // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bad(() => {})).toBe(true)
    expect(bad((c) => delete c.source.canvas)).toBe(false)
    expect(bad((c) => delete c.source.frame)).toBe(false)
    expect(bad((c) => delete c.notes[0].verifyBox)).toBe(false)
    expect(bad((c) => delete c.review)).toBe(false)
  })
  it('a fallback bundle needs no review', () => {
    const r = buildRecipeBundle({ ...input(), review: undefined, by: 'Test Reader', merged: { ...merged, readers: ['fallback'] } as never })
    // the schema decides on transcription.readers: with a fallback reader a missing review is accepted
    expect(r.ok).toBe(true)
  })
})

describe('the committed quinces bundle (R3.5, R3.6, R21.7)', () => {
  const b = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
  it('carries the canvas, the frame, the verbatim reviewer and a verifyBox per note', () => {
    expect(b.source.canvas).toEqual({ id: 'https://iiif.wellcomecollection.org/presentation/b18419665/canvases/b18419665_MS_1810_0033.JP2', width: 3695, height: 4737 })
    expect(b.source.frame).toMatchObject({ width: 1601, height: 2052 })
    expect(b.review?.reviewedBy).toBe('Claude Code builder agent (autopilot P1b), not a human')
    expect(b.review?.reviewedAt).toBe('2026-11-25')
    expect(b.notes.every((n) => n.verifyBox.length === 4)).toBe(true)
  })
  it('regenerating it left the gate untouched: gateSha256 is still the one the review was written against', () => {
    expect(b.gateSha256).toBe('eb3fabc0734badca8e4d48d2df8748f969ff00e2ac0ad546ffc6c59a838df10d')
  })
})
