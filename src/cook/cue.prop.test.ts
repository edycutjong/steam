import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { brownNoise, cueEnvelope, LAMP_DIP_MS, LAMP_MIN, SIMMER_DUCK, SIMMER_END_MS, SIMMER_GAIN, simmerGainAt } from './cue.ts'

// K6 (design 13): the cue and the noise.
describe('K6: the cue', () => {
  it('lamp in [LAMP_MIN, 1] and simmer in [SIMMER_DUCK, 1] for every t; exactly 1 outside their span', () => {
    fc.assert(
      fc.property(fc.double({ min: -2000, max: 6000, noNaN: true }), (t) => {
        const { lamp, simmer } = cueEnvelope(t)
        expect(lamp).toBeGreaterThanOrEqual(LAMP_MIN)
        expect(lamp).toBeLessThanOrEqual(1)
        expect(simmer).toBeGreaterThanOrEqual(SIMMER_DUCK)
        expect(simmer).toBeLessThanOrEqual(1)
        if (t <= 0 || t >= LAMP_DIP_MS) expect(lamp).toBe(1)
        if (t <= 0 || t >= SIMMER_END_MS) expect(simmer).toBe(1)
        expect(simmerGainAt(t)).toBeLessThanOrEqual(SIMMER_GAIN)
      }),
      { numRuns: 1000 },
    )
  })
  it('each curve has one minimum: non-increasing, then non-decreasing', () => {
    for (const key of ['lamp', 'simmer'] as const) {
      let rising = false
      let prev = 1
      for (let t = 0; t <= 2500; t += 1) {
        const v = cueEnvelope(t)[key]
        if (v > prev + 1e-12) rising = true
        if (rising) expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
        prev = v
      }
    }
  })
})

// energy at one frequency by the Goertzel recurrence
const power = (x: Float32Array, f: number, fs: number): number => {
  const w = (2 * Math.PI * f) / fs
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (const v of x) {
    const s = v + c * s1 - s2
    s2 = s1
    s1 = s
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2
}

describe('K6: brownNoise', () => {
  const sizes = fc.integer({ min: 8192, max: 24_000 })
  it('is deterministic, within [-1, 1], has a mean near zero, a seam without a click, and more energy below 200 Hz than above 2 kHz', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), sizes, (seed, n) => {
        const a = brownNoise(n, seed)
        expect(brownNoise(n, seed)).toEqual(a)
        expect(a.length).toBe(n)
        let sum = 0
        let sq = 0
        for (let i = 0; i < n; i++) {
          expect(Math.abs(a[i]!)).toBeLessThanOrEqual(1)
          sum += a[i]!
          if (i > 0) sq += (a[i]! - a[i - 1]!) ** 2
        }
        // measured over 1 200 seed/size pairs (8 192 to 88 200 samples): largest |mean| 0.104, largest seam step 1.84 x the RMS step
        expect(Math.abs(sum / n)).toBeLessThan(0.15)
        const rms = Math.sqrt(sq / (n - 1))
        // the step from the last sample back to the first is an ordinary step of the walk, not a click
        expect(Math.abs(a[0]! - a[n - 1]!)).toBeLessThanOrEqual(5 * rms)
        const low = [50, 100, 150, 190].reduce((s, f) => s + power(a, f, 44_100), 0)
        const high = [2500, 4000, 8000, 12_000].reduce((s, f) => s + power(a, f, 44_100), 0)
        expect(low).toBeGreaterThan(high)
      }),
      { numRuns: 60 },
    )
  })
})
