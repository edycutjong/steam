// P1 on generated structures: the checker agrees with an independent statement of the property.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkP1, type P1Input } from './props.ts'

const partition = (n: number, title: number | null, cuts: number[]): { n: number; lineIdx: number[] }[] => {
  const lines = Array.from({ length: n }, (_, i) => i).filter((i) => i !== title)
  const steps: { n: number; lineIdx: number[] }[] = []
  let cur: number[] = []
  lines.forEach((l, k) => {
    cur.push(l)
    if (cuts.includes(k) || k === lines.length - 1) (steps.push({ n: steps.length + 1, lineIdx: cur }), (cur = []))
  })
  return steps
}
const base = fc.record({
  n: fc.integer({ min: 2, max: 14 }),
  hasTitle: fc.boolean(),
  cuts: fc.array(fc.nat(13), { maxLength: 6 }),
  nNotes: fc.integer({ min: 0, max: 3 }),
  align: fc.array(fc.constantFrom('auto', 'curator', 'lines') as fc.Arbitrary<'auto' | 'curator' | 'lines'>, { minLength: 3, maxLength: 3 }),
})

function valid(b: { n: number; hasTitle: boolean; cuts: number[]; nNotes: number; align: ('auto' | 'curator' | 'lines')[] }): P1Input {
  const title = b.hasTitle ? 0 : null
  const notes = Array.from({ length: b.nNotes }, (_, i) => ({
    id: `n${i}`,
    alignment: b.align[i]!,
    granularity: (b.align[i] === 'lines' ? 'lines' : 'words') as 'lines' | 'words',
  }))
  return { lineCount: b.n, titleLine: title, steps: partition(b.n, title, b.cuts), notes, masks: notes.map((x) => ({ noteId: x.id, granularity: x.granularity })) }
}

/** The property stated directly. */
function independent(i: P1Input): boolean {
  const seen = new Map<number, number>()
  for (const s of i.steps) for (const l of s.lineIdx) seen.set(l, (seen.get(l) ?? 0) + 1)
  for (let l = 0; l < i.lineCount; l++) {
    if (l === i.titleLine) {
      if (seen.has(l)) return false
    } else if (seen.get(l) !== 1) return false
  }
  for (const l of seen.keys()) if (l < 0 || l >= i.lineCount) return false
  for (const n of i.notes) {
    const ms = i.masks.filter((m) => m.noteId === n.id)
    if (ms.length !== 1) return false
    if (ms[0]!.granularity !== n.granularity || (n.alignment === 'lines') !== (n.granularity === 'lines')) return false
  }
  return i.masks.every((m) => i.notes.some((n) => n.id === m.noteId))
}

describe('P1 structure', () => {
  it('random partitions pass', () => {
    fc.assert(
      fc.property(base, (b) => {
        const i = valid(b)
        expect(independent(i)).toBe(true)
        expect(checkP1(i).pass).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
  it('one line in two steps, one line dropped, the title in a step, an unknown line, zero or two masks: each fails with the right message', () => {
    fc.assert(
      fc.property(base, fc.nat(), (b, pick) => {
        const i = valid(b)
        const covered = i.steps.flatMap((s) => s.lineIdx)
        const l = covered[pick % covered.length]!
        const twice: P1Input = { ...i, steps: [...i.steps, { n: i.steps.length + 1, lineIdx: [l] }] }
        expect(checkP1(twice).pass).toBe(false)
        expect(checkP1(twice).detail).toContain(`line ${l} is in 2 steps`)
        expect(independent(twice)).toBe(false)
        const dropped: P1Input = { ...i, steps: i.steps.map((s) => ({ ...s, lineIdx: s.lineIdx.filter((x) => x !== l) })).filter((s) => s.lineIdx.length) }
        expect(checkP1(dropped).detail).toContain(`line ${l} is in no step`)
        if (i.titleLine !== null) {
          const t: P1Input = { ...i, steps: [{ ...i.steps[0]!, lineIdx: [...i.steps[0]!.lineIdx, i.titleLine] }, ...i.steps.slice(1)] }
          expect(checkP1(t).detail).toContain('names the title line')
          expect(independent(t)).toBe(false)
        }
        const unknown: P1Input = { ...i, steps: [{ ...i.steps[0]!, lineIdx: [...i.steps[0]!.lineIdx, i.lineCount + 3] }, ...i.steps.slice(1)] }
        expect(checkP1(unknown).detail).toContain('unknown line')
        if (i.notes.length) {
          const none: P1Input = { ...i, masks: i.masks.slice(1) }
          expect(checkP1(none).detail).toContain('has 0 masks')
          const two: P1Input = { ...i, masks: [...i.masks, i.masks[0]!] }
          expect(checkP1(two).detail).toContain('has 2 masks')
          const wrong: P1Input = { ...i, masks: i.masks.map((m, k) => (k === 0 ? { ...m, granularity: m.granularity === 'words' ? 'lines' : 'words' } : m)) }
          expect(checkP1(wrong).pass).toBe(false)
        }
      }),
      { numRuns: 200 },
    )
  })
})
