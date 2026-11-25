import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BLOOM_FADE_MS, BLOOM_HOLD, bloomAt, candleDipAt, candleLevel, CANDLE_DIP } from './haunt.ts'
import { THICKEN_MS, WRITE_ON_MS } from './timeline.ts'

describe('bloomAt', () => {
  it('is 0 before the thickening and after the write-on has been held 1.5 s', () => {
    expect(bloomAt(-THICKEN_MS)).toBe(0)
    expect(bloomAt(-5000)).toBe(0)
    expect(bloomAt(WRITE_ON_MS + BLOOM_FADE_MS)).toBe(0)
    expect(bloomAt(60000)).toBe(0)
  })
  it('creeps in over the 1.2 s thickening to 1, then relaxes to the hold level', () => {
    expect(bloomAt(-THICKEN_MS / 2)).toBeCloseTo(0.5, 6)
    expect(bloomAt(0)).toBe(1)
    expect(bloomAt(WRITE_ON_MS - 1)).toBeCloseTo(BLOOM_HOLD, 3)
  })
  it('is 0 for NaN and infinities', () => {
    for (const t of [NaN, Infinity, -Infinity]) expect(bloomAt(t)).toBe(0)
  })
})

describe('candle', () => {
  it('dips during the cue and recovers when the note holds', () => {
    expect(candleDipAt(-THICKEN_MS)).toBe(0)
    expect(candleDipAt(0)).toBe(1)
    expect(candleDipAt(WRITE_ON_MS + BLOOM_FADE_MS)).toBe(0)
    expect(candleLevel(1.3, 1000)).toBeLessThan(candleLevel(1.3, -THICKEN_MS - 1) * (1 - CANDLE_DIP) + 0.2)
  })
})

describe('bloomAt (P-H1)', () => {
  it('stays in [0, 1] for every t', () => {
    fc.assert(fc.property(fc.double({ min: -20000, max: 40000, noNaN: true }), (t) => bloomAt(t) >= 0 && bloomAt(t) <= 1))
  })
  it('is continuous', () => {
    fc.assert(fc.property(fc.double({ min: -3000, max: 9000, noNaN: true }), (t) => Math.abs(bloomAt(t + 1) - bloomAt(t)) < 0.01))
  })
})
