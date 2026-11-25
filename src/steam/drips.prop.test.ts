import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RUN_AMP_CSS, RUN_LEAN_MAX, dripDistance, dripEnd, runOffset, type PlacedRun } from './drips.ts'

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
  return { x: r.x, y0: r.y0, len: r.len, tStart: r.tStart, len1: r.len - len2, dur1: r.dur1, pause: r.pause, len2, dur2: r.dur2, halfWidth: 1, headR: 3, seed: 1, u0: 0.2, amp: 2, lean: 0, lip: 10 }
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

describe('runOffset (R13.3)', () => {
  const path = fc.record({
    amp: fc.double({ min: RUN_AMP_CSS.lo, max: RUN_AMP_CSS.hi, noNaN: true }),
    lean: fc.double({ min: -RUN_LEAN_MAX, max: RUN_LEAN_MAX, noNaN: true }),
    seed: fc.double({ min: 0, max: 100, noNaN: true }),
  })
  it('is 0 at the start and bounded by amp + lean * dy', () => {
    fc.assert(
      fc.property(path, fc.double({ min: 0, max: 400, noNaN: true }), (r, dy) => {
        return runOffset(r, 0) === 0 && Math.abs(runOffset(r, dy)) <= r.amp + Math.abs(r.lean) * dy + 1e-9
      }),
      { numRuns: 500 },
    )
  })
  it('is a pure function of its arguments', () => {
    fc.assert(fc.property(path, fc.double({ min: 0, max: 400, noNaN: true }), (r, dy) => runOffset(r, dy) === runOffset({ ...r }, dy)))
  })
  it('bends: a run of 60 css px or more is not a straight vertical line for any seed', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (seed) => {
        let lo = 0
        let hi = 0
        for (let dy = 0; dy <= 90; dy += 1.5) {
          const o = runOffset({ amp: RUN_AMP_CSS.lo, lean: 0, seed }, dy)
          lo = Math.min(lo, o)
          hi = Math.max(hi, o)
        }
        return hi - lo >= 0.9
      }),
      { numRuns: 300 },
    )
  })
})
