import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BLOOM_FADE_MS,
  BLOOM_HOLD,
  BREATH_MS,
  CANDLE_DIP,
  CLOUD_OVER_MOON,
  CLOUD_TRAVEL,
  FINGER_LEAD_MS,
  bloomAt,
  breathAt,
  candleDipAt,
  candleLean,
  candleLevel,
  cloudShiftAt,
  coldBreathAt,
  fingerU,
  moonDimAt,
} from './haunt.ts'
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

describe('look pass 3: something unseen is writing (R21)', () => {
  it('the finger leads the ink by 250 to 350 ms and never past the end (R21.1)', () => {
    expect(FINGER_LEAD_MS).toBeGreaterThanOrEqual(250)
    expect(FINGER_LEAD_MS).toBeLessThanOrEqual(350)
    expect(fingerU(0.5)).toBeCloseTo(0.5 + FINGER_LEAD_MS / WRITE_ON_MS, 9)
    expect(fingerU(0.99)).toBe(1)
    expect(fingerU(-1)).toBe(0)
  })
  it('breathAt pulses over the first 1.5 s of the write-on, peaking between 100 and 600 ms (R21.2)', () => {
    expect(breathAt(0)).toBe(0)
    expect(breathAt(-300)).toBe(0)
    expect(breathAt(BREATH_MS)).toBe(0)
    expect(breathAt(9000)).toBe(0)
    let peakAt = 0
    let peak = 0
    for (let t = 0; t <= BREATH_MS; t += 5) if (breathAt(t) > peak) [peak, peakAt] = [breathAt(t), t]
    expect(peak).toBeGreaterThan(0.95)
    expect(peakAt).toBeGreaterThanOrEqual(100)
    expect(peakAt).toBeLessThanOrEqual(600)
  })
  it('the cold breath blooms through the thickening and is gone by 800 ms (R21.3)', () => {
    expect(coldBreathAt(-THICKEN_MS)).toBe(0)
    expect(coldBreathAt(-600)).toBeCloseTo(0.5, 6)
    expect(coldBreathAt(0)).toBe(1)
    expect(coldBreathAt(800)).toBe(0)
    expect(candleDipAt(-600)).toBeGreaterThanOrEqual(0.5)
  })
  it('the candle leans toward the head, only while the cue is on (R21.4)', () => {
    expect(candleLean(100, 900, 1000, true)).toBeLessThan(0)
    expect(candleLean(1000, 900, 1000, true)).toBeGreaterThan(0)
    expect(candleLean(100, 900, 1000, false)).toBe(0)
    expect(candleLean(NaN, 900, 1000, true)).toBe(0)
  })
  it('the cloud crosses the moon during the write-on and is clear by the hold plus 3 s (R21.5)', () => {
    let over = false
    for (let t = 1000; t <= 5000; t += 20) if (Math.abs(cloudShiftAt(t) - CLOUD_OVER_MOON) < 12) over = true
    expect(over).toBe(true)
    expect(cloudShiftAt(-5000)).toBe(0)
    expect(cloudShiftAt(WRITE_ON_MS + 3000)).toBeGreaterThanOrEqual(CLOUD_TRAVEL - 1)
    expect(moonDimAt(3300)).toBeGreaterThan(0.4)
    expect(moonDimAt(-3000)).toBe(0)
    expect(moonDimAt(12000)).toBe(0)
  })
  it('stays in range and is monotone (P-H2)', () => {
    fc.assert(
      fc.property(fc.double({ min: -20000, max: 40000, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }), (t, d) => {
        const b = breathAt(t)
        const c = coldBreathAt(t)
        const m = moonDimAt(t)
        return b >= 0 && b <= 1 && c >= 0 && c <= 1 && m >= 0 && m <= 0.5 && cloudShiftAt(t + d) >= cloudShiftAt(t)
      }),
    )
    fc.assert(
      fc.property(fc.double({ min: -2000, max: 2000, noNaN: true }), fc.double({ min: 10, max: 5000, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }), fc.boolean(), (h, c, w, on) => {
        const v = candleLean(h, c, w, on)
        return v >= -1 && v <= 1
      }),
    )
  })
})
