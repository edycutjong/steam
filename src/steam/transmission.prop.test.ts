import fc from 'fast-check'
import { describe, it } from 'vitest'
import { catmullRom1D, sampleCatmull, trans } from './transmission.ts'

describe('trans (P-T1, P-T2)', () => {
  it('is monotone and stays in [0, 1]', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (x, y) => {
        const [a, b] = x <= y ? [x, y] : [y, x]
        const ta = trans(a)
        const tb = trans(b)
        return ta <= tb && ta >= 0 && tb <= 1
      }),
    )
  })
  it('is continuous: slope at most 2.5 everywhere (no narrow threshold band)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 0.05, noNaN: true }), (a, e) => {
        return Math.abs(trans(Math.min(1, a + e)) - trans(a)) <= 2.5 * e + 1e-12
      }),
      { numRuns: 2000 },
    )
  })
})

describe('Catmull-Rom (P-C1)', () => {
  it('has weights summing to 1', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (f) => Math.abs(catmullRom1D(f).reduce((a, b) => a + b, 0) - 1) < 1e-12))
  })
  it('stays within [0, 1] and interpolates texel centres exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 64, maxLength: 64 }),
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 8, noNaN: true }),
        (w, h, data, x, y) => {
          const v = sampleCatmull(data, w, h, x, y)
          const ci = Math.floor(x % w)
          const cj = Math.floor(y % h)
          const centre = sampleCatmull(data, w, h, ci + 0.5, cj + 0.5)
          return v >= 0 && v <= 1 && Math.abs(centre - data[cj * w + ci] / 255) < 1e-9
        },
      ),
    )
  })
})
