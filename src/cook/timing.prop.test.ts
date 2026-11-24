import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkLabel, effectiveCheckAt, formatDuration, stepSeconds, TIMING_MAX_S } from './timing.ts'

// K8 (design 13): check labels and overrides. (The K3 block is added with the timer, task 19.)
const parseDuration = (s: string): number => {
  const m = /^(?:(\d+) min)?(?: ?(\d+) s)?$/.exec(s)!
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}
const checkAt = fc.record({
  seconds: fc.integer({ min: 0, max: TIMING_MAX_S }),
  source: fc.constantFrom('cited' as const, 'step-entry' as const, 'cook' as const),
  basis: fc.stringMatching(/^[a-z ]{3,20}$/),
})

describe('K8: check labels and overrides', () => {
  it('effectiveCheckAt is the override when present, else the bundle value; the label names its source', () => {
    fc.assert(
      fc.property(checkAt, fc.option(fc.integer({ min: 0, max: TIMING_MAX_S }), { nil: undefined }), (c, o) => {
        const note = { id: 'n', checkAt: c }
        const e = effectiveCheckAt(note, o === undefined ? {} : { n: o })
        if (o === undefined) expect(e).toEqual(c)
        else expect(e).toEqual({ seconds: o, source: 'cook', basis: 'set by you on this device' })
        const label = checkLabel(e)
        if (e.source === 'step-entry') expect(label).toBe('with its step')
        if (e.source === 'cited') expect(label).toContain(`cited: ${e.basis}`)
        if (e.source === 'cook') expect(label).toContain('set by you')
      }),
      { numRuns: 500 },
    )
  })
  it('formatDuration is monotone in seconds and re-parses', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: TIMING_MAX_S }), fc.integer({ min: 0, max: TIMING_MAX_S }), (a, b) => {
        expect(parseDuration(formatDuration(a))).toBe(a)
        if (a <= b) expect(parseDuration(formatDuration(a))).toBeLessThanOrEqual(parseDuration(formatDuration(b)))
      }),
      { numRuns: 500 },
    )
  })
  it('the stepper never leaves [0, TIMING_MAX_S], moves by exactly 30 s unless clamped, and reset restores the bundle value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: TIMING_MAX_S }), fc.array(fc.constantFrom(-1 as const, 1 as const), { maxLength: 60 }), (start, dirs) => {
        let v = start
        for (const d of dirs) {
          const next = stepSeconds(v, d)
          expect(next).toBeGreaterThanOrEqual(0)
          expect(next).toBeLessThanOrEqual(TIMING_MAX_S)
          const raw = v + d * 30
          if (raw >= 0 && raw <= TIMING_MAX_S) expect(next).toBe(raw)
          v = next
        }
        // reset = deleting the override: the effective time is the bundle's again
        const note = { id: 'n', checkAt: { seconds: 0, source: 'step-entry' as const, basis: 'x' } }
        expect(effectiveCheckAt(note, {})).toEqual(note.checkAt)
      }),
      { numRuns: 300 },
    )
  })
})
