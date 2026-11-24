import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { elapsedMs, initialState, nextDueWall, noteState, reduce, type SchedEvent, type SchedState } from './scheduler.ts'

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

describe('sleep, resume, pace, show (R12.7, R12.8, R11.5, R10.4)', () => {
  const started = () => run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }]).s
  it('sleep before the due time emits nothing; ticks, show and wipe while asleep emit nothing and change only lastWall', () => {
    let s = reduce(timedPlan, started(), { type: 'sleep', wallMs: 10_000 }).state
    expect(s.asleep).toBe(true)
    for (const type of ['tick', 'show', 'wipe'] as const) {
      const r = reduce(timedPlan, s, { type, wallMs: 90_000 })
      expect(r.effects).toEqual([])
      expect(r.state).toEqual({ ...s, lastWall: 90_000 })
      s = r.state
    }
  })
  it('resume after the due time emits exactly one reveal; before it emits none and the reveal comes later by tick', () => {
    const asleep = reduce(timedPlan, started(), { type: 'sleep', wallMs: 10_000 }).state
    const late = reduce(timedPlan, asleep, { type: 'resume', wallMs: 600_000 })
    expect(reveals(late.effects).length).toBe(1)
    expect(reduce(timedPlan, late.state, { type: 'tick', wallMs: 700_000 }).effects).toEqual([])
    const early = reduce(timedPlan, asleep, { type: 'resume', wallMs: 20_000 })
    expect(early.effects).toEqual([])
    expect(reveals(reduce(timedPlan, early.state, { type: 'tick', wallMs: 60_000 }).effects).length).toBe(1)
  })
  it('setPace 4 at 30 s of a 60 s note: elapsed 30 s, pace 4, the reveal falls at wall 37.5 s', () => {
    let s = reduce(timedPlan, started(), { type: 'setPace', wallMs: 30_000, pace: 4 }).state
    expect(elapsedMs(s, 30_000)).toBe(30_000)
    expect(s.paceHistory.at(-1)!.pace).toBe(4)
    expect(nextDue(s)).toBe(37_500)
    expect(reduce(timedPlan, s, { type: 'tick', wallMs: 37_499 }).effects).toEqual([])
    const r = reduce(timedPlan, s, { type: 'tick', wallMs: 37_500 })
    expect(reveals(r.effects).length).toBe(1)
    s = r.state
  })
  it('a reveal due before the pace change is emitted before the pace changes', () => {
    const r = reduce(timedPlan, started(), { type: 'setPace', wallMs: 70_000, pace: 12 })
    expect(r.effects).toEqual([{ type: 'reveal', noteId: 'a', stepIndex: 0, cause: 'scheduled', wallMs: 70_000 }])
    expect(r.state.paceHistory.at(-1)).toEqual({ atWall: 70_000, pace: 12 })
  })
  it('setting the same pace twice adds no history; two changes at one wall time keep the last', () => {
    let s = started()
    s = reduce(timedPlan, s, { type: 'setPace', wallMs: 1_000, pace: 1 }).state
    expect(s.paceHistory.length).toBe(1)
    s = reduce(timedPlan, s, { type: 'setPace', wallMs: 2_000, pace: 4 }).state
    s = reduce(timedPlan, s, { type: 'setPace', wallMs: 2_000, pace: 4 }).state
    expect(s.paceHistory.length).toBe(2)
    s = reduce(timedPlan, s, { type: 'setPace', wallMs: 2_000, pace: 12 }).state
    expect(s.paceHistory).toEqual([{ atWall: 0, pace: 1 }, { atWall: 2_000, pace: 12 }])
    s = reduce(timedPlan, s, { type: 'setPace', wallMs: 2_000, pace: 1 }).state // back to the previous pace: the segment disappears
    expect(s.paceHistory).toEqual([{ atWall: 0, pace: 1 }])
  })
  it('show on a pending note emits reveal {show}; on a revealed note or no note, nothing; a later scheduled reveal is a no-op', () => {
    let r = reduce(timedPlan, started(), { type: 'show', wallMs: 5_000 })
    expect(r.effects).toEqual([{ type: 'reveal', noteId: 'a', stepIndex: 0, cause: 'show', wallMs: 5_000 }])
    expect(reduce(timedPlan, r.state, { type: 'show', wallMs: 6_000 }).effects).toEqual([])
    expect(reduce(timedPlan, r.state, { type: 'tick', wallMs: 70_000 }).effects).toEqual([])
    const noNote = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'show', wallMs: 1 }, { type: 'wipe', wallMs: 2 }]).s // wipe reveals a, then advances to the no-note step 1
    expect(noNote.stepIndex).toBe(1)
    r = reduce(timedPlan, noNote, { type: 'show', wallMs: 3 })
    expect(r.effects).toEqual([])
  })
})
const nextDue = (s: SchedState) => nextDueWall(timedPlan, s)
