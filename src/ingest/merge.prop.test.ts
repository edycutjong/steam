// S4: for all pairs of readings, the transcription round-trips and no disagreement disappears.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatTranscription, markedText, mergeReadings, parseMarked, parseTranscription, tokenise } from './merge.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const word = fc.constantFrom('the', 'Quince', 'Quince,', 'boil', '&', 'it', 'till', 'Looks', 'red', 'smooth,', 'sug.r', 'L.', 'E.', 'quince')
const line = fc.array(word, { minLength: 1, maxLength: 9 }).map((t) => t.join(' '))
const readings = fc.integer({ min: 1, max: 8 }).chain((n) => fc.tuple(fc.array(line, { minLength: n, maxLength: n }), fc.array(line, { minLength: n, maxLength: n })))
const mk = (texts: string[]) => ({ segmentRun: run, lines: texts.map((text, i) => ({ i, text })) })

describe('S4 merge properties', () => {
  it('both readings are recoverable from the merge (no disagreement disappears) and the markdown round-trips', () => {
    fc.assert(
      fc.property(readings, ([ta, tb]) => {
        const m = mergeReadings(mk(ta), mk(tb))
        m.lines.forEach((l, k) => {
          const a = l.atoms.flatMap((x) => (x.kind === 'tok' ? [x.text] : x.a))
          const b = l.atoms.flatMap((x) => (x.kind === 'tok' ? [x.text] : x.b))
          expect(a).toEqual(tokenise(ta[k]!))
          expect(b).toEqual(tokenise(tb[k]!))
          expect(parseMarked(markedText(l.atoms))).toEqual(l.atoms)
          expect(l.wordCount === null).toBe(tokenise(ta[k]!).length !== tokenise(tb[k]!).length)
        })
        const nDis = m.lines.reduce((s, l) => s + l.atoms.filter((x) => x.kind === 'dis').length, 0)
        expect(m.disagreements.length).toBe(nDis)
        const header = { segmentRun: run.id, readers: ['d'.repeat(64), 'e'.repeat(64)] as [string, string] }
        const p = parseTranscription(formatTranscription(header, m.lines))
        expect(p.ok).toBe(true)
        if (!p.ok) return
        expect(p.header).toEqual(header)
        expect(p.lines.map((l) => l.i)).toEqual(m.lines.map((l) => l.i))
        p.lines.forEach((l, k) => expect(parseMarked(l.text)).toEqual(m.lines[k]!.atoms))
        // identical readings never disagree
        expect(mergeReadings(mk(ta), mk(ta)).disagreements).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})
