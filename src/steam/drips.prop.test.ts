import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dripDistance, dripEnd, type PlacedRun } from './drips.ts'

const run = fc.record({
  x: fc.double({ min: 10, max: 300, noNaN: true }),
  y0: fc.double({ min: 0, max: 200, noNaN: true }),
  len: fc.double({ min: 16, max: 120, noNaN: true }),
  tStart: fc.double({ min: 0, max: 8000, noNaN: true }),
  dur1: fc.double({ min: 500, max: 2000, noNaN: true }),
  pause: fc.double({ min: 300, max: 1200, noNaN: true }),
  dur2: fc.double({ min: 400, max: 1500, noNaN: true }),
  split: fc.double({ min: 0, max: 0.9, noNaN: true }),
}).map((r): PlacedRun => {
  const len2 = r.len * r.split * 0.5
  return { x: r.x, y0: r.y0, len: r.len, tStart: r.tStart, len1: r.len - len2, dur1: r.dur1, pause: r.pause, len2, dur2: r.dur2, halfWidth: 1, headR: 3, seed: 1, u0: 0.2 }
})

describe('dripDistance (P-D1, P-D2)', () => {
  it('is monotone in time and bounded by the run length', () => {
    fc.assert(
      fc.property(run, fc.double({ min: -1000, max: 30000, noNaN: true }), fc.double({ min: -1000, max: 30000, noNaN: true }), (r, a, b) => {
        const [t1, t2] = a <= b ? [a, b] : [b, a]
        const d1 = dripDistance(r, t1)
        const d2 = dripDistance(r, t2)
        return d1 <= d2 + 1e-9 && d1 >= 0 && d2 <= r.len + 1e-9
      }),
      { numRuns: 500 },
    )
  })
  it('is zero before the start and settled after the end', () => {
    fc.assert(
      fc.property(run, (r) => dripDistance(r, r.tStart) === 0 && Math.abs(dripDistance(r, dripEnd(r) + 1) - dripDistance(r, dripEnd(r) + 1e6)) < 1e-9),
    )
  })
  it('is a pure function of its arguments', () => {
    fc.assert(fc.property(run, fc.double({ min: 0, max: 20000, noNaN: true }), (r, t) => dripDistance(r, t) === dripDistance({ ...r }, t)))
    expect(true).toBe(true)
  })
})
