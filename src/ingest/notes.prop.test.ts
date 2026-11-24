// S6: a span is accepted iff it equals the primary text of its quote; any one-character edit is rejected.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mergeSingle, tokenise } from './merge.ts'
import { checkNotes, checkSteps, effectiveLines } from './notes.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const word = fc.constantFrom('the', 'Quince,', 'boil', '&', 'it', 'till', 'Looks', 'red', 'smooth,', 'sug.r', 'L.', 'Liquor,', 'when', 'Tender,')
const line = fc.array(word, { minLength: 2, maxLength: 9 }).map((t) => t.join(' '))
const scene = fc
  .tuple(fc.array(line, { minLength: 2, maxLength: 5 }), fc.nat(), fc.nat(), fc.nat())
  .map(([texts, a, b, c]) => ({ texts, a, b, c }))

describe('S6 notes', () => {
  it('accepts exactly the quoted words, rejects every one-character edit of the span', () => {
    fc.assert(
      fc.property(scene, fc.integer({ min: 0, max: 2 }), fc.nat(), fc.nat(), ({ texts, a, b, c }, editKind, pos, chr) => {
        const lines = effectiveLines(mergeSingle({ segmentRun: run, lines: texts.map((text, i) => ({ i, text })) }))
        const steps = [{ n: 1, lineIdx: texts.map((_, i) => i), text: lines.map((l) => l.primary).join(' ') }]
        expect(checkSteps(lines, steps)).toEqual([])
        // a quote over one or two consecutive lines
        const l0 = a % texts.length
        const two = l0 + 1 < texts.length && c % 2 === 0
        const t0 = tokenise(texts[l0]!)
        const from = b % t0.length
        const quote = two
          ? [{ line: l0, fromWord: from, toWord: t0.length - 1 }, { line: l0 + 1, fromWord: 0, toWord: (c >> 1) % tokenise(texts[l0 + 1]!).length }]
          : [{ line: l0, fromWord: from, toWord: from + (c % (t0.length - from)) }]
        const span = quote.map((q) => tokenise(texts[q.line]!).slice(q.fromWord, q.toWord + 1).join(' ')).join(' ')
        const good = checkNotes(lines, steps, [{ id: 'n', step: 1, span, quote }])
        expect(good.errors).toEqual([])
        // one-character edits
        const p = pos % (span.length + 1)
        const ch = String.fromCharCode(97 + (chr % 26))
        const edited = editKind === 0 ? span.slice(0, p) + ch + span.slice(p) : editKind === 1 && span.length > 0 ? span.slice(0, p % span.length) + span.slice((p % span.length) + 1) : span.slice(0, p % Math.max(1, span.length)) + (span[p % Math.max(1, span.length)] === ch ? 'Z' : ch) + span.slice((p % Math.max(1, span.length)) + 1)
        if (edited === span || edited === '') return
        const bad = checkNotes(lines, steps, [{ id: 'n', step: 1, span: edited, quote }])
        expect(bad.errors.length).toBeGreaterThan(0)
        expect(bad.errors.join()).toMatch(/span is not a quotation/)
      }),
      { numRuns: 400 },
    )
  })
})
