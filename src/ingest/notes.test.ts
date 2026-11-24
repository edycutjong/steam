import { describe, expect, it } from 'vitest'
import type { NoteDef, StepDef } from '../data/schema.ts'
import { mergeReadings, mergeSingle, tokenise, type EffectiveLine, type MergeResult } from './merge.ts'
import { checkNotes, checkSteps, effectiveLines } from './notes.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const mk = (...t: string[]) => ({ segmentRun: run, lines: t.map((text, i) => ({ i, text })) })
const L = (m: MergeResult): EffectiveLine[] => effectiveLines(m)

const text = ['To make Marmalade', 'to the Quinces, & boil it till it Looks', 'red & smooth, keeping it stirred all', 'The time it Boils']
const m = mergeSingle(mk(...text))
const lines = L(m)
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

describe('checkSteps (R17.1, R17.2)', () => {
  it('accepts numbered steps whose text is the primary text of their lines', () => {
    expect(checkSteps(lines, steps)).toEqual([])
  })
  it('rejects numbering gaps, a non-consecutive or descending lineIdx, an empty step and wrong text', () => {
    expect(checkSteps(lines, [{ ...steps[0]!, n: 2 }, steps[1]!]).join()).toMatch(/numbered/)
    expect(checkSteps(lines, [{ n: 1, lineIdx: [1, 3], text: 'x' }]).join()).toMatch(/consecutive/)
    expect(checkSteps(lines, [{ n: 1, lineIdx: [2, 1], text: 'x' }]).join()).toMatch(/consecutive/)
    expect(checkSteps(lines, [{ n: 1, lineIdx: [], text: 'x' }]).join()).toMatch(/empty|consecutive/)
    expect(checkSteps(lines, [{ n: 1, lineIdx: [3], text: 'The time it boils' }]).join()).toMatch(/step 1 text is not the primary text/)
    expect(checkSteps(lines, [{ n: 1, lineIdx: [9], text: 'x' }]).join()).toMatch(/unknown line 9/)
  })
})

describe('checkNotes (R17.3 to R17.6)', () => {
  it('accepts the hero quote, trailing comma included', () => {
    const r = checkNotes(lines, steps, [hero])
    expect(r.errors).toEqual([])
    expect(r.notes[0]!.parts).toEqual([
      { line: 1, fromWord: 6, toWord: 8, tokenCount: 9, k: 9, tokens: tokenise(lines[1]!.primary) },
      { line: 2, fromWord: 0, toWord: 2, tokenCount: 7, k: 7, tokens: tokenise(lines[2]!.primary) },
    ])
  })
  it('accepts the hero span without the trailing comma of its last word, and records the quoted words', () => {
    const r = checkNotes(lines, steps, [{ ...hero, span: 'till it Looks red & smooth' }])
    expect(r.errors).toEqual([])
    expect(r.notes[0]!.quoted).toBe('till it Looks red & smooth,')
  })
  it('rejects any other edit: a comma dropped inside the span, a word changed, a comma added', () => {
    for (const span of ['till it Looks red & smoot', 'till it looks red & smooth', 'till it Looks red & smooth,,', 'till it Looks red &smooth'])
      expect(checkNotes(lines, steps, [{ ...hero, span }]).errors.join(), span).toMatch(/span is not a quotation/)
    const mid = checkNotes(lines, steps, [{ ...hero, span: 'to the Quinces', quote: [{ line: 1, fromWord: 0, toWord: 2 }] }])
    expect(mid.errors).toEqual([])
    const midBad = checkNotes(lines, steps, [{ ...hero, span: 'to the Quinces &', quote: [{ line: 1, fromWord: 0, toWord: 3 }] }])
    expect(midBad.errors.join()).toMatch(/span is not a quotation/)
  })
  it('rejects a missing step, a line outside the step, bad bounds and unordered or partial multi-line parts', () => {
    const bad = (n: Partial<NoteDef>) => checkNotes(lines, steps, [{ ...hero, ...n }]).errors.join()
    expect(bad({ step: 9 })).toMatch(/step 9 does not exist/)
    expect(bad({ quote: [{ line: 3, fromWord: 0, toWord: 1 }], span: 'The time' })).toMatch(/line 3 is not in step 1/)
    expect(bad({ quote: [{ line: 1, fromWord: 6, toWord: 9 }], span: 'x' })).toMatch(/words 6..9 outside/)
    expect(bad({ quote: [{ line: 1, fromWord: 5, toWord: 4 }], span: 'x' })).toMatch(/words 5..4 outside/)
    expect(bad({ quote: [{ line: 2, fromWord: 0, toWord: 6 }, { line: 1, fromWord: 0, toWord: 8 }], span: 'x' })).toMatch(/increasing line order/)
    expect(bad({ quote: [{ line: 1, fromWord: 6, toWord: 7 }, { line: 2, fromWord: 0, toWord: 2 }], span: 'x' })).toMatch(/must end at the line's last word/)
    expect(bad({ quote: [{ line: 1, fromWord: 6, toWord: 8 }, { line: 2, fromWord: 1, toWord: 2 }], span: 'x' })).toMatch(/must start at word 0/)
  })
  it('rejects duplicate note ids', () => {
    expect(checkNotes(lines, steps, [hero, hero]).errors.join()).toMatch(/duplicate note id/)
  })
  it('rejects a quote that starts inside a multi-token disagreement', () => {
    const mm = mergeReadings(mk(...text), mk(text[0]!, 'to the Quinces, & boil it tillit Looks', text[2]!, text[3]!))
    const ls = L(mm)
    const r = checkNotes(ls, steps, [{ ...hero, span: 'it Looks red & smooth,', quote: [{ line: 1, fromWord: 7, toWord: 8 }, { line: 2, fromWord: 0, toWord: 2 }] }])
    expect(r.errors.join()).toMatch(/quote splits a disagreement/)
    // quoting the whole region is fine
    const ok = checkNotes(ls, steps, [{ ...hero, span: 'till it Looks red & smooth,', quote: [{ line: 1, fromWord: 6, toWord: 8 }, { line: 2, fromWord: 0, toWord: 2 }] }])
    expect(ok.errors).toEqual([])
    expect(ok.notes[0]!.parts[0]!.k).toBeNull()
  })
})
