// S2: tilt estimate within 0.2 degrees, deskew leaves small tilts untouched, and the line count survives.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyDeskew, estimateTilt } from './deskew.ts'
import { findLines, rowProfile } from './lines.ts'
import { inkMap } from './threshold.ts'
import { blank, mulberry32, textRow } from './synth.ts'

describe('S2 deskew on synthetic ruled text', () => {
  it('estimates within 0.2 degrees for |tilt| <= 3, applies only from 0.5 degrees, and the line count is N', () => {
    fc.assert(
      fc.property(fc.integer({ min: -30, max: 30 }), fc.integer({ min: 3, max: 6 }), fc.integer({ min: 1, max: 1e6 }), (tenths, n, seed) => {
        const tilt = tenths / 10
        const rnd = mulberry32(seed)
        const c = blank(640, 110 + n * 84)
        for (let i = 0; i < n; i++)
          textRow(c, { yc: 70 + i * 84, hh: 14, x0: 24, words: [4, 3, 5, 4, 3, 4], gap: 12 + Math.floor(rnd() * 4), slant: rnd() * 0.3, tilt })
        const est = estimateTilt(c.ink, c.w, c.h)
        expect(Math.abs(est - tilt)).toBeLessThanOrEqual(0.2)
        const g = { width: c.w, height: c.h, data: c.ink.map((v) => (v ? 40 : 235)) }
        const r = applyDeskew(g, est)
        expect(r.applied).toBe(Math.abs(est) >= 0.5)
        if (!r.applied) expect(r.gray.data).toEqual(g.data)
        expect(findLines(rowProfile(inkMap(r.gray), g.width, g.height)).lines.length).toBe(n)
      }),
      { numRuns: 25 },
    )
  })
})
