import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RecipeBundle } from '../data/schema.ts'
import type { Plan } from './plan.ts'
import { initialState, reduce, type SchedState } from './scheduler.ts'
import { checkLabel, effectiveCheckAt, emberActive, EMBER_WINDOW_S, formatDuration, formatElapsed, OVERRIDE_BASIS, stepSeconds, TIMING_MAX_S, TIMING_STEP_S } from './timing.ts'

const real = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))

describe('check times (R8)', () => {
  it('formatDuration', () => {
    expect(formatDuration(30)).toBe('30 s')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(90)).toBe('1 min 30 s')
    expect(formatDuration(10800)).toBe('180 min')
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(59)).toBe('59 s')
  })
  it('checkLabel of the real hero checkAt is "with its step"', () => {
    const hero = real.notes.find((n) => n.id === 'till-it-looks-red-smooth')!
    expect(checkLabel(hero.checkAt)).toBe('with its step')
  })
  it('labels a cited time with its basis, and a cook time with its source', () => {
    expect(checkLabel({ seconds: 600, source: 'cited', basis: 'boil ten minutes' })).toBe('check from 10 min · cited: boil ten minutes')
    expect(checkLabel({ seconds: 90, source: 'cook', basis: OVERRIDE_BASIS })).toBe('check from 1 min 30 s · set by you')
    expect(checkLabel({ seconds: 0, source: 'cook', basis: OVERRIDE_BASIS })).toBe('with its step · set by you')
  })
  it('effectiveCheckAt prefers the override and carries source cook and its basis', () => {
    const n = real.notes[0]!
    expect(effectiveCheckAt(n, {})).toBe(n.checkAt)
    expect(effectiveCheckAt(n, { [n.id]: 90 })).toEqual({ seconds: 90, source: 'cook', basis: 'set by you on this device' })
    expect(effectiveCheckAt(n, { other: 90 })).toBe(n.checkAt)
  })
  it('the stepper moves 30 s and clamps to 0 and 10 800', () => {
    expect(TIMING_STEP_S).toBe(30)
    expect(TIMING_MAX_S).toBe(10_800)
    expect(stepSeconds(0, 1)).toBe(30)
    expect(stepSeconds(30, -1)).toBe(0)
    expect(stepSeconds(0, -1)).toBe(0)
    expect(stepSeconds(10_790, 1)).toBe(10_800)
    expect(stepSeconds(10_800, 1)).toBe(10_800)
  })
  it('the real bundle has step-entry at 0 s on all three notes (R8.7)', () => {
    expect(real.notes.length).toBe(3)
    for (const n of real.notes) expect(n.checkAt).toMatchObject({ source: 'step-entry', seconds: 0 })
  })
})

describe('formatElapsed (R10.1)', () => {
  it.each([[0, '0:00'], [7_999, '0:07'], [125_000, '2:05'], [3_725_000, '1:02:05'], [-5, '0:00'], [59_999, '0:59'], [3_600_000, '1:00:00']])('%d ms is %s', (ms, out) => expect(formatElapsed(ms)).toBe(out))
})

describe('emberActive (R10.4)', () => {
  const plan: Plan = { steps: [{ note: { id: 'a', checkAtMs: 600_000 } }, { note: null }] }
  const running = (pace: 1 | 4 | 12): SchedState => reduce(plan, initialState, { type: 'start', wallMs: 0, pace }).state
  it('the window is 10 s', () => expect(EMBER_WINDOW_S).toBe(10))
  it('pending note due in 10 s of wall time at pace 12: true; 10.001 s: false; due now: false', () => {
    const s = running(12) // due at 600 000 / 12 = 50 000 ms of wall time
    expect(emberActive(plan, s, 40_000)).toBe(true)
    expect(emberActive(plan, s, 39_999)).toBe(false)
    expect(emberActive(plan, s, 49_999)).toBe(true)
    expect(emberActive(plan, s, 50_000)).toBe(false)
  })
  it('false when revealed, asleep or with no note', () => {
    const s = running(1)
    expect(emberActive(plan, reduce(plan, s, { type: 'show', wallMs: 1 }).state, 595_000)).toBe(false)
    expect(emberActive(plan, reduce(plan, s, { type: 'sleep', wallMs: 1 }).state, 595_000)).toBe(false)
    expect(emberActive(plan, { ...s, stepIndex: 1 }, 595_000)).toBe(false)
  })
})
