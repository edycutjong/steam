import { describe, expect, it } from 'vitest'
import { brownNoise, CUE_COOLDOWN_MS, cueEnvelope, LAMP_DIP_MS, LAMP_MIN, SIMMER_DUCK, SIMMER_GAIN, simmerGainAt } from './cue.ts'

describe('cueEnvelope (R16.1, R16.8)', () => {
  it('is exactly 1 at and before 0, and after its end', () => {
    expect(cueEnvelope(0)).toEqual({ lamp: 1, simmer: 1 })
    expect(cueEnvelope(-50)).toEqual({ lamp: 1, simmer: 1 })
    expect(cueEnvelope(LAMP_DIP_MS).lamp).toBe(1)
    expect(cueEnvelope(2100)).toEqual({ lamp: 1, simmer: 1 })
    expect(cueEnvelope(9999)).toEqual({ lamp: 1, simmer: 1 })
  })
  it('the lamp reaches LAMP_MIN at 200 ms and holds to 300 ms; the simmer reaches its duck at 300 ms and holds to 600 ms', () => {
    expect(cueEnvelope(200).lamp).toBeCloseTo(LAMP_MIN, 12)
    expect(cueEnvelope(299).lamp).toBe(LAMP_MIN)
    expect(cueEnvelope(300).simmer).toBeCloseTo(SIMMER_DUCK, 12)
    expect(cueEnvelope(599).simmer).toBe(SIMMER_DUCK)
  })
  it('the gain never exceeds SIMMER_GAIN and its floor is SIMMER_GAIN x SIMMER_DUCK', () => {
    for (let t = -10; t < 2500; t += 7) {
      expect(simmerGainAt(t)).toBeLessThanOrEqual(SIMMER_GAIN)
      expect(simmerGainAt(t)).toBeGreaterThanOrEqual(SIMMER_GAIN * SIMMER_DUCK - 1e-12)
    }
  })
  it('the constants', () => expect([LAMP_DIP_MS, CUE_COOLDOWN_MS]).toEqual([900, 3000]))
})

describe('brownNoise (R16.8)', () => {
  it('is deterministic per seed and different across seeds', () => {
    expect(brownNoise(9000, 1)).toEqual(brownNoise(9000, 1))
    expect(brownNoise(9000, 1)).not.toEqual(brownNoise(9000, 2))
  })
  it('has a peak of 0.9 and a mean near zero', () => {
    const n = brownNoise(88_200, 7)
    expect(Math.max(...n.map(Math.abs))).toBeCloseTo(0.9, 5)
    expect(Math.abs(n.reduce((a, b) => a + b, 0) / n.length)).toBeLessThan(0.05)
  })
})
