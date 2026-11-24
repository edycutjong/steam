// S3: for all N-row synthetic pages, findLines returns N lines, core bands disjoint, valley rows strictly between them.
import fc from 'fast-check'
import { describe, it, expect } from 'vitest'
import { findLines, rowProfile } from './lines.ts'
import { blank, mulberry32, textRow } from './synth.ts'

describe('S3 findLines on synthetic pages', () => {
  it('returns N lines, disjoint cores, valleys strictly between cores', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 54, max: 90 }),
        fc.integer({ min: 9, max: 16 }),
        fc.integer({ min: 1, max: 1e6 }),
        (n, pitch, hh, seed) => {
          const rnd = mulberry32(seed)
          const c = blank(420, 80 + n * pitch)
          const truth: number[] = []
          for (let i = 0; i < n; i++) {
            const yc = 50 + i * pitch
            truth.push(yc)
            textRow(c, { yc, hh, x0: 16, words: [3 + Math.floor(rnd() * 3), 3, 4, 3 + Math.floor(rnd() * 3)], gap: 14, slant: rnd() * 0.4 })
          }
          const r = findLines(rowProfile(c.ink, c.w, c.h))
          expect(r.lines.length).toBe(n)
          r.lines.forEach((l, i) => expect(Math.abs(l.peakRow - truth[i]!)).toBeLessThanOrEqual(3))
          for (let i = 0; i + 1 < n; i++) {
            expect(r.lines[i]!.core[1]).toBeLessThan(r.valleys[i]!)
            expect(r.valleys[i]!).toBeLessThan(r.lines[i + 1]!.core[0])
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})
