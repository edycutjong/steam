import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { elapsedMs, initialState, reduce, type Pace, type SchedEvent } from './scheduler.ts'
import { checkLabel, effectiveCheckAt, emberActive, formatDuration, formatElapsed, stepSeconds, TIMING_MAX_S } from './timing.ts'

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


// K3 (design 13): the step clock.
const paceArb = fc.constantFrom<Pace>(1, 4, 12)
describe('K3: the step clock', () => {
  const plan: Plan = { steps: [{ note: { id: 'a', checkAtMs: 3_600_000 } }, { note: null }] }
  it('elapsedMs equals the independent sum of pace x dt over non-decreasing wall times', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 100_000 }), paceArb), { minLength: 1, maxLength: 30 }), (steps) => {
        let s = reduce(plan, initialState, { type: 'start', wallMs: 0, pace: steps[0]![1] }).state
        let wall = 0
        let want = 0
        let pace = steps[0]![1]
        for (const [d, p] of steps) {
          wall += d
          want += pace * d
          s = reduce(plan, s, { type: 'setPace', wallMs: wall, pace: p }).state
          pace = p
          expect(elapsedMs(s, wall)).toBe(want)
        }
      }),
      { numRuns: 300 },
    )
  })
  it('the sequence of elapsedMs outputs from reduce is non-decreasing for wall times with decreases', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -5_000, max: 60_000 }), { minLength: 1, maxLength: 60 }), (deltas) => {
        let s = reduce(plan, initialState, { type: 'start', wallMs: 100_000, pace: 4 }).state
        let wall = 100_000
        let prev = 0
        for (const d of deltas) {
          wall += d
          const e: SchedEvent = { type: 'tick', wallMs: wall }
          s = reduce(plan, s, e).state
          const el = elapsedMs(s, wall)
          expect(el).toBeGreaterThanOrEqual(prev)
          prev = el
        }
      }),
      { numRuns: 300 },
    )
  })
  it('formatElapsed is monotone and re-parses to floor(ms / 1000)', () => {
    const parse = (t: string) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0)
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40_000_000 }), fc.integer({ min: 0, max: 40_000_000 }), (a, b) => {
        expect(parse(formatElapsed(a))).toBe(Math.floor(a / 1000))
        if (a <= b) expect(parse(formatElapsed(a))).toBeLessThanOrEqual(parse(formatElapsed(b)))
      }),
      { numRuns: 500 },
    )
  })
  it('emberActive is true exactly when a reveal is pending and the wall time left is in (0, 10 s], at paces 1, 4 and 12', () => {
    fc.assert(
      fc.property(paceArb, fc.integer({ min: 1, max: 3_600 }), fc.integer({ min: 0, max: 400_000 }), (pace, checkS, at) => {
        const p: Plan = { steps: [{ note: { id: 'a', checkAtMs: checkS * 1000 } }, { note: null }] }
        const s = reduce(p, initialState, { type: 'start', wallMs: 0, pace }).state
        const dueWall = (checkS * 1000) / pace
        const left = dueWall - at
        expect(emberActive(p, s, at)).toBe(left > 0 && left <= 10_000)
      }),
      { numRuns: 500 },
    )
  })
})
