// E6-E8 of specs/agents.md section 7, run against the REAL gate code (checkSteps, checkNotes, checkP1). Each `it` title starts
// with its eval id; scripts/eval_agents.py maps results by that prefix. [claude-direct]
import { describe, expect, it } from 'vitest'
import type { NoteDef, StepDef } from '../../src/data/schema.ts'
import { mergeSingle, type EffectiveLine } from '../../src/ingest/merge.ts'
import { checkNotes, checkSteps, effectiveLines } from '../../src/ingest/notes.ts'
import { checkP1 } from '../../src/ingest/props.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const text = ['To make Marmalade', 'to the Quinces, & boil it till it Looks', 'red & smooth, keeping it stirred all', 'The time it Boils']
const lines: EffectiveLine[] = effectiveLines(mergeSingle({ segmentRun: run, lines: text.map((t, i) => ({ i, text: t })) }))
const steps: StepDef[] = [
  { n: 1, lineIdx: [1, 2], text: `${text[1]} ${text[2]}` },
  { n: 2, lineIdx: [3], text: text[3]! },
]
const hero: NoteDef = {
  id: 'looks-red-smooth',
  step: 1,
  span: 'till it Looks red & smooth,',
  quote: [{ line: 1, fromWord: 6, toWord: 8 }, { line: 2, fromWord: 0, toWord: 2 }],
}

describe('agent-output evals (deterministic)', () => {
  it('E6 a line index beyond the page and a word index beyond the line are rejected', () => {
    expect(checkSteps(lines, [{ n: 1, lineIdx: [99], text: 'x' }]).join()).toMatch(/unknown line 99/)
    expect(checkNotes(lines, steps, [{ ...hero, quote: [{ line: 1, fromWord: 6, toWord: 99 }], span: 'x' }]).errors.join()).toMatch(/words 6..99 outside/)
  })
  it('E7 one line assigned to two steps fails P1', () => {
    const r = checkP1({ lineCount: 4, titleLine: 0, steps: [{ n: 1, lineIdx: [1, 2] }, { n: 2, lineIdx: [2, 3] }], notes: [], masks: [] })
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/line 2 is in 2 steps/)
  })
  it('E8 a paraphrased note is rejected, the verbatim span is accepted', () => {
    expect(checkNotes(lines, steps, [{ ...hero, span: 'cook until red' }]).errors.join()).toMatch(/span is not a quotation/)
    expect(checkNotes(lines, steps, [{ ...hero, span: 'boil until it looks red & smooth' }]).errors.join()).toMatch(/span is not a quotation/)
    expect(checkNotes(lines, steps, [hero]).errors).toEqual([])
  })
})
