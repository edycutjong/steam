import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { elapsedMs, initialState, noteState, reduce, type SchedEvent, type SchedState } from './scheduler.ts'

// Hand-built plans (test fixtures): 3 steps; notes on steps 0 and 2.
const note = (id: string, checkAtMs: number) => ({ id, checkAtMs })
const entryPlan: Plan = { steps: [{ note: note('a', 0) }, { note: null }, { note: note('c', 0) }] }
const timedPlan: Plan = { steps: [{ note: note('a', 60_000) }, { note: null }, { note: note('c', 0) }] }

const run = (plan: Plan, events: SchedEvent[], s: SchedState = initialState) => {
  const effects = []
  for (const e of events) {
    const r = reduce(plan, s, e)
    s = r.state
    effects.push(...r.effects)
  }
  return { s, effects }
}
const reveals = (effects: { type: string }[]) => effects.filter((e) => e.type === 'reveal')

describe('start and the scheduled reveal (R12.1, R12.2, R12.4)', () => {
  it('start on a step-entry note emits reveal {scheduled} at the start wall time', () => {
    const { s, effects } = run(entryPlan, [{ type: 'start', wallMs: 1000, pace: 1 }])
    expect(effects).toEqual([{ type: 'reveal', noteId: 'a', stepIndex: 0, cause: 'scheduled', wallMs: 1000 }])
    expect(noteState(entryPlan, s)).toBe('revealed')
  })
  it('a note due at 60 s at pace 1: nothing at 59 999 ms, one reveal at 60 000, nothing after', () => {
    let { s } = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }])
    expect(reduce(timedPlan, s, { type: 'tick', wallMs: 59_999 }).effects).toEqual([])
    const r = reduce(timedPlan, s, { type: 'tick', wallMs: 60_000 })
    expect(r.effects).toEqual([{ type: 'reveal', noteId: 'a', stepIndex: 0, cause: 'scheduled', wallMs: 60_000 }])
    s = r.state
    expect(reduce(timedPlan, s, { type: 'tick', wallMs: 61_000 }).effects).toEqual([])
  })
})

describe('deepLink (R12.9, R12.10)', () => {
  it('at step 2 with leadMs 10 000: nothing at 9 999, the reveal at 10 000', () => {
    const { s } = run(entryPlan, [{ type: 'deepLink', wallMs: 0, stepIndex: 2, leadMs: 10_000, pace: 12 }])
    expect(s.stepIndex).toBe(2)
    expect(reduce(entryPlan, s, { type: 'tick', wallMs: 9_999 }).effects).toEqual([])
    expect(reduce(entryPlan, s, { type: 'tick', wallMs: 10_000 }).effects).toEqual([{ type: 'reveal', noteId: 'c', stepIndex: 2, cause: 'scheduled', wallMs: 10_000 }])
  })
  it('with lead 0 it emits at once', () => {
    const { effects } = run(entryPlan, [{ type: 'deepLink', wallMs: 5, stepIndex: 2, leadMs: 0, pace: 1 }])
    expect(reveals(effects).length).toBe(1)
  })
  it('the hold is wall time (not scaled by the pace) and applies to the initial step only', () => {
    let { s } = run(entryPlan, [{ type: 'deepLink', wallMs: 0, stepIndex: 0, leadMs: 10_000, pace: 12 }])
    expect(reduce(entryPlan, s, { type: 'tick', wallMs: 5_000 }).effects).toEqual([]) // 5 s x 12 = 60 s of step time, still held
    s = reduce(entryPlan, s, { type: 'show', wallMs: 5_000 }).state
    const w = reduce(entryPlan, s, { type: 'wipe', wallMs: 5_100 })
    expect(w.state.holdUntilWall).toBeNull()
    expect(w.state.stepIndex).toBe(1)
  })
  it('clamps an out-of-range step', () => {
    expect(run(entryPlan, [{ type: 'deepLink', wallMs: 0, stepIndex: 99, leadMs: 0, pace: 1 }]).s.stepIndex).toBe(2)
    expect(run(entryPlan, [{ type: 'deepLink', wallMs: 0, stepIndex: -4, leadMs: 0, pace: 1 }]).s.stepIndex).toBe(0)
  })
})

describe('elapsedMs (R10.2, R10.3, R12.5, R12.6)', () => {
  it('is the sum of pace x dt over paces 1, 4, 12', () => {
    const { s } = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'setPace', wallMs: 1_000, pace: 4 }, { type: 'setPace', wallMs: 3_000, pace: 12 }])
    expect(elapsedMs(s, 4_000)).toBe(1 * 1_000 + 4 * 2_000 + 12 * 1_000)
  })
  it('a wall time lower than lastWall changes nothing', () => {
    const { s } = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'tick', wallMs: 5_000 }])
    expect(elapsedMs(s, 2_000)).toBe(5_000)
    const r = reduce(timedPlan, s, { type: 'tick', wallMs: 1_000 })
    expect(r.state).toEqual(s)
    expect(r.effects).toEqual([])
  })
  it('idle gives 0', () => expect(elapsedMs(initialState, 999)).toBe(0))
})

describe('only the first event starts (R12.11)', () => {
  it('events before the first event change nothing', () => {
    for (const type of ['tick', 'sleep', 'resume', 'show', 'wipe'] as const) {
      const r = reduce(entryPlan, initialState, { type, wallMs: 5 })
      expect(r.state).toEqual(initialState)
      expect(r.effects).toEqual([])
    }
    expect(reduce(entryPlan, initialState, { type: 'setPace', wallMs: 5, pace: 4 }).state).toEqual(initialState)
  })
  it('start, deepLink and restore after the first event change nothing but lastWall', () => {
    const { s } = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }])
    for (const e of [{ type: 'start', wallMs: 9, pace: 4 }, { type: 'deepLink', wallMs: 9, stepIndex: 2, leadMs: 0, pace: 4 }, { type: 'restore', wallMs: 9, snapshot: { v: 1, recipeId: 'x', stepIndex: 2, stepStartWall: 0, paceHistory: [{ atWall: 0, pace: 1 }], revealed: [] } }] as SchedEvent[]) {
      const r = reduce(timedPlan, s, e)
      expect(r.state).toEqual({ ...s, lastWall: 9 })
      expect(r.effects).toEqual([])
    }
  })
})
