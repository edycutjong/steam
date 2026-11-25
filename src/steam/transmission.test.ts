import { describe, expect, it } from 'vitest'
import { TRANS_GAMMA, TRANS_HI, TRANS_LO, catmullRom1D, sampleCatmull, trans } from './transmission.ts'

describe('trans', () => {
  it('is 0 at no ink and 1 at full ink', () => {
    expect(trans(0)).toBe(0)
    expect(trans(TRANS_LO)).toBe(0)
    expect(trans(1)).toBe(1)
    expect(trans(TRANS_HI)).toBe(1)
  })
  it('lets hairlines through partly (the pen pressure shows)', () => {
    expect(trans(0.15)).toBeGreaterThan(0.06)
    expect(trans(0.15)).toBeLessThan(0.4)
    expect(trans(0.5)).toBeGreaterThan(0.45)
    expect(trans(0.5)).toBeLessThan(0.85)
  })
  it('spreads over most of the alpha range, never a narrow band', () => {
    // alpha range where T lies strictly between 5 % and 95 %
    let lo = 1
    let hi = 0
    for (let a = 0; a <= 1; a += 0.001) {
      const t = trans(a)
      if (t > 0.05 && t < 0.95) {
        lo = Math.min(lo, a)
        hi = Math.max(hi, a)
      }
    }
    expect(hi - lo).toBeGreaterThan(0.6)
  })
  it('uses the documented constants', () => {
    expect([TRANS_LO, TRANS_HI, TRANS_GAMMA]).toEqual([0.03, 0.97, 0.9])
  })
})

describe('Catmull-Rom', () => {
  it('has weights that sum to 1 and hit the texel at f = 0', () => {
    expect(catmullRom1D(0).map((x) => x + 0)).toEqual([0, 1, 0, 0])
    for (const f of [0.1, 0.5, 0.9]) expect(catmullRom1D(f).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })
  it('returns a texel exactly at its centre and is smooth between texels', () => {
    const w = 4
    const h = 1
    const data = [0, 255, 0, 0]
    expect(sampleCatmull(data, w, h, 1.5, 0.5)).toBeCloseTo(1, 12)
    expect(sampleCatmull(data, w, h, 0.5, 0.5)).toBeCloseTo(0, 12)
    const mid = sampleCatmull(data, w, h, 1.0, 0.5)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })
})
