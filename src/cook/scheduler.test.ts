import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { Snapshot } from './session.ts'
import { controlFor, elapsedMs, initialState, nextDueWall, noteState, reduce, toSnapshot,  type SchedEvent, type SchedState } from './scheduler.ts'

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


describe('wipe, advance, finish (R12.3, R14.1, R14.7)', () => {
  it('wipe on a revealed note advances and, on arrival at a step-entry note, reveals in the same event', () => {
    const plan: Plan = { steps: [{ note: note('a', 0) }, { note: note('b', 0) }] }
    const s = run(plan, [{ type: 'start', wallMs: 0, pace: 1 }]).s
    const r = reduce(plan, s, { type: 'wipe', wallMs: 1000 })
    expect(r.effects).toEqual([{ type: 'advance', stepIndex: 1, wallMs: 1000 }, { type: 'reveal', noteId: 'b', stepIndex: 1, cause: 'scheduled', wallMs: 1000 }])
  })
  it('wipe on a no-note step advances', () => {
    const s = run(entryPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'wipe', wallMs: 10 }]).s
    expect(s.stepIndex).toBe(1)
    const r = reduce(entryPlan, s, { type: 'wipe', wallMs: 20 })
    expect(r.effects[0]).toEqual({ type: 'advance', stepIndex: 2, wallMs: 20 })
  })
  it('wipe on a pending note emits reveal {wipe} then advance', () => {
    const s = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }]).s
    const r = reduce(timedPlan, s, { type: 'wipe', wallMs: 1000 })
    expect(r.effects).toEqual([{ type: 'reveal', noteId: 'a', stepIndex: 0, cause: 'wipe', wallMs: 1000 }, { type: 'advance', stepIndex: 1, wallMs: 1000 }])
  })
  it('wipe on the last step emits finish; afterwards every event changes nothing but lastWall', () => {
    const s = run(entryPlan, [{ type: 'deepLink', wallMs: 0, stepIndex: 2, leadMs: 0, pace: 1 }]).s
    const r = reduce(entryPlan, s, { type: 'wipe', wallMs: 50 })
    expect(r.effects).toEqual([{ type: 'finish', wallMs: 50 }])
    expect(r.state.status).toBe('finished')
    for (const type of ['tick', 'show', 'wipe', 'sleep', 'resume'] as const) {
      const x = reduce(entryPlan, r.state, { type, wallMs: 60 })
      expect(x.effects).toEqual([])
      expect(x.state).toEqual({ ...r.state, lastWall: 60 })
    }
  })
  it('the step timer restarts at 0 on arrival and the pace carries over', () => {
    let s = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 4 }, { type: 'show', wallMs: 100 }]).s
    s = reduce(timedPlan, s, { type: 'wipe', wallMs: 1_000 }).state
    expect(s.stepIndex).toBe(1)
    expect(s.stepStartWall).toBe(1_000)
    expect(s.paceHistory).toEqual([{ atWall: 1_000, pace: 4 }])
    expect(elapsedMs(s, 1_000)).toBe(0)
    expect(elapsedMs(s, 2_000)).toBe(4_000)
  })
})

describe('controlFor: the Wipe table (R14.1)', () => {
  const plan: Plan = { steps: [{ note: note('a', 60_000) }, { note: null }, { note: note('c', 0) }, { note: null }] }
  const at = (stepIndex: number, revealed: string[] = []): SchedState => ({ ...initialState, status: 'running', stepIndex, revealed, lastWall: 0, stepStartWall: 0, paceHistory: [{ atWall: 0, pace: 1 }] })
  it('no note, not last: "Next step" wipes', () => expect(controlFor(plan, at(1))).toEqual({ label: 'Next step', action: 'wipe', leavesCook: false }))
  it('pending: "Show the note" shows', () => expect(controlFor(plan, at(0))).toEqual({ label: 'Show the note', action: 'show', leavesCook: false }))
  it('revealed, not last: "Wipe the glass" wipes', () => expect(controlFor(plan, at(2, ['c']))).toEqual({ label: 'Wipe the glass', action: 'wipe', leavesCook: false }))
  it('last step revealed: "The hand, quoted" leaves Cook Mode', () => {
    const p: Plan = { steps: [{ note: null }, { note: note('z', 0) }] }
    expect(controlFor(p, { ...at(1, ['z']) })).toEqual({ label: 'The hand, quoted', action: 'wipe', leavesCook: true })
  })
  it('last step no note: "The hand, quoted" leaves Cook Mode', () => expect(controlFor(plan, at(3))).toEqual({ label: 'The hand, quoted', action: 'wipe', leavesCook: true }))
})

describe('nextDueWall (R12.8)', () => {
  it('equals the wall time at which a tick first emits the reveal, with two pace changes', () => {
    let s = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'setPace', wallMs: 10_000, pace: 4 }, { type: 'setPace', wallMs: 20_000, pace: 12 }]).s
    // 10 s at x1 + 10 s at x4 = 50 s, then 10 s left at x12 -> 833.33 ms
    const t = nextDueWall(timedPlan, s)!
    expect(t).toBeCloseTo(20_000 + 10_000 / 12, 6)
    expect(reduce(timedPlan, s, { type: 'tick', wallMs: t - 0.01 }).effects).toEqual([])
    expect(reveals(reduce(timedPlan, s, { type: 'tick', wallMs: t + 1e-6 }).effects).length).toBe(1)
    s = reduce(timedPlan, s, { type: 'sleep', wallMs: 20_001 }).state
    expect(nextDueWall(timedPlan, s)).toBeNull()
  })
  it('is null when finished, revealed, without a note or idle; waits for the hold', () => {
    expect(nextDueWall(timedPlan, initialState)).toBeNull()
    const s = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'show', wallMs: 1 }]).s
    expect(nextDueWall(timedPlan, s)).toBeNull()
    const held = run(entryPlan, [{ type: 'deepLink', wallMs: 100, stepIndex: 2, leadMs: 10_000, pace: 12 }, { type: 'tick', wallMs: 200 }]).s
    expect(nextDueWall(entryPlan, held)).toBe(10_100)
    const noNote = run(entryPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'wipe', wallMs: 1 }]).s
    expect(nextDueWall(entryPlan, noNote)).toBeNull()
  })
})

describe('snapshot and restore (R18.2)', () => {
  it('toSnapshot then restore gives the same step, history and revealed', () => {
    const s = run(timedPlan, [{ type: 'start', wallMs: 0, pace: 1 }, { type: 'setPace', wallMs: 1_000, pace: 4 }, { type: 'show', wallMs: 2_000 }]).s
    const snap = Snapshot.parse(toSnapshot(s, 'r'))
    const back = reduce(timedPlan, initialState, { type: 'restore', wallMs: 3_000, snapshot: snap })
    expect(back.state).toMatchObject({ stepIndex: s.stepIndex, stepStartWall: s.stepStartWall, paceHistory: s.paceHistory, revealed: s.revealed })
    expect(back.effects).toEqual([]) // a restore does not reveal a note already revealed
  })
  it('a restore on a step whose note is due reveals it once', () => {
    const snap: Snapshot = { v: 1, recipeId: 'r', stepIndex: 0, stepStartWall: 0, paceHistory: [{ atWall: 0, pace: 1 }], revealed: [] }
    const r = reduce(timedPlan, initialState, { type: 'restore', wallMs: 120_000, snapshot: snap })
    expect(reveals(r.effects).length).toBe(1)
    expect(reveals(reduce(timedPlan, r.state, { type: 'tick', wallMs: 130_000 }).effects).length).toBe(0)
  })
  it('drops revealed ids that are not in the plan', () => {
    const snap: Snapshot = { v: 1, recipeId: 'r', stepIndex: 1, stepStartWall: 0, paceHistory: [{ atWall: 0, pace: 1 }], revealed: ['a', 'gone'] }
    expect(reduce(timedPlan, initialState, { type: 'restore', wallMs: 5, snapshot: snap }).state.revealed).toEqual(['a'])
  })
})
