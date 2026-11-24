import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { displayableNotes } from '../data/provenance.ts'
import { RecipeBundle } from '../data/schema.ts'
import { buildPlan, paneNoteFor, type Plan } from './plan.ts'

const real = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
const { notes } = displayableNotes(real)

describe('buildPlan (R8.1, R12.1)', () => {
  it('has 5 steps with notes on steps 1, 4 and 5, each due at 0 ms', () => {
    const p = buildPlan(real, notes, {})
    expect(p.steps.length).toBe(5)
    expect(p.steps.map((s) => s.note?.id ?? null)).toEqual(['full-ripe', null, null, 'when-tender', 'till-it-looks-red-smooth'])
    expect(p.steps.flatMap((s) => (s.note ? [s.note.checkAtMs] : []))).toEqual([0, 0, 0])
  })
  it('a 60 s override on when-tender makes it due at 60 000 ms', () => {
    const p = buildPlan(real, notes, { 'when-tender': 60 })
    expect(p.steps[3]!.note).toEqual({ id: 'when-tender', checkAtMs: 60_000 })
  })
  it('a withheld note leaves its step empty', () => {
    const p = buildPlan(real, notes.filter((n) => n.id !== 'when-tender'), {})
    expect(p.steps[3]!.note).toBeNull()
  })
})

describe('paneNoteFor (R15.5)', () => {
  const p = buildPlan(real, notes, {})
  it('follows the table of the design', () => {
    expect([0, 1, 2, 3, 4].map((i) => paneNoteFor(p, i))).toEqual(['full-ripe', 'when-tender', 'when-tender', 'when-tender', 'till-it-looks-red-smooth'])
  })
  it('gives null for a plan with no note', () => expect(paneNoteFor({ steps: [{ note: null }, { note: null }] }, 0)).toBeNull())
  it('a plan whose only note is on step 0 gives it for every later step', () => {
    const only: Plan = { steps: [{ note: { id: 'a', checkAtMs: 0 } }, { note: null }, { note: null }] }
    expect([0, 1, 2].map((i) => paneNoteFor(only, i))).toEqual(['a', 'a', 'a'])
  })
})
