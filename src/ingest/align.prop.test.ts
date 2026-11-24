// S5: no 8-connected piece spans two words of an alignment, for |s| <= 1; accepted alignments obey the 1.5x rule.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { alignAuto, assignWords } from './align.ts'
import { labelComponents } from './components.ts'
import { RUN_RATIO } from './constants.ts'
import { collectLinePixels, zeroRuns } from './runs.ts'
import { blank, mulberry32, stroke } from './synth.ts'

function randomLine(seed: number) {
  const rnd = mulberry32(seed)
  const c = blank(220, 60)
  const n = 3 + Math.floor(rnd() * 9)
  let x = 8
  for (let i = 0; i < n; i++) {
    const lean = Math.floor(rnd() * 21) - 10
    stroke(c, x + lean, 8 + Math.floor(rnd() * 8), x - lean, 40 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 2))
    if (rnd() < 0.5) stroke(c, x - 3, 30, x + 8 + Math.floor(rnd() * 12), 30 + Math.floor(rnd() * 5) - 2, 2)
    x += 4 + Math.floor(rnd() * 24)
  }
  const owner = new Int16Array(c.w * c.h).fill(-1)
  for (let i = 0; i < owner.length; i++) if (c.ink[i]) owner[i] = 0
  return { c, px: collectLinePixels(owner, c.w, c.h, 1)[0]! }
}

describe('S5 alignment properties', () => {
  it('no 8-connected piece spans two words, whichever runs are chosen as boundaries, for |s| <= 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: 1, max: 1e9 }), (seed, s100, pick) => {
        const { c, px } = randomLine(seed)
        const s = s100 / 100
        const r = zeroRuns(px, 30, s)
        const rnd = mulberry32(pick)
        const chosen = r.runs.filter(() => rnd() < 0.6)
        const bounds = chosen.map((u) => Math.floor((u.x0 + u.x1) / 2))
        const word = assignWords(px, 30, s, bounds)
        const labels = labelComponents(c.ink, c.w, c.h)
        const wordOf = new Map<number, number>()
        for (let i = 0; i < word.length; i++) {
          const id = labels.label[px.ys[i]! * c.w + px.xs[i]!]!
          const seen = wordOf.get(id)
          if (seen === undefined) wordOf.set(id, word[i]!)
          else expect(seen).toBe(word[i])
        }
      }),
      { numRuns: 200 },
    )
  })

  it('accepted alignments have k-1 boundaries, a strictly wider (k-1)th run and satisfy the 1.5x rule', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 4, max: 30 }), { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 14 }), (widths, k) => {
        const runs = widths.map((w, i) => ({ index: i, x0: i * 100, x1: i * 100 + w - 1, width: w }))
        const r = alignAuto(runs, k)
        if (!r.ok) return
        expect(r.boundaries.length).toBe(k - 1)
        expect([...r.boundaries].sort((a, b) => a - b)).toEqual(r.boundaries)
        const ranked = [...widths].sort((a, b) => b - a)
        if (k > 1) {
          const kth = ranked[k - 2]!
          const rest = ranked.slice(k - 1)
          if (rest.length) expect(kth).toBeGreaterThan(rest[0]!)
          const sorted = [...rest].sort((a, b) => a - b)
          const m = sorted.length === 0 ? 4 : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
          expect(kth).toBeGreaterThanOrEqual(RUN_RATIO * m - 1e-9)
        }
      }),
      { numRuns: 400 },
    )
  })
})
