import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { elapsedMs, initialState, reduce, toSnapshot, type Pace, type SchedEvent, type SchedState } from './scheduler.ts'
import { SESSION_MAX_AGE_MS, Snapshot, snapshotValid } from './session.ts'

// K5 (design 13): session snapshots.
const planArb: fc.Arbitrary<Plan> = fc.integer({ min: 1, max: 6 }).chain((n) =>
  fc.array(fc.option(fc.integer({ min: 0, max: 600_000 }), { nil: null }), { minLength: n, maxLength: n }).map((cs) => ({ steps: cs.map((c, i) => ({ note: c === null ? null : { id: `n${i}`, checkAtMs: c } })) })),
)
const evs = fc.array(fc.tuple(fc.constantFrom('tick', 'show', 'wipe', 'setPace', 'sleep', 'resume'), fc.integer({ min: 0, max: 400_000 }), fc.constantFrom<Pace>(1, 4, 12)), { maxLength: 40 })
const running = fc.tuple(planArb, fc.constantFrom<Pace>(1, 4, 12), evs).map(([plan, pace0, es]) => {
  let s: SchedState = reduce(plan, initialState, { type: 'start', wallMs: 1_000_000, pace: pace0 }).state
  let w = 1_000_000
  for (const [k, d, p] of es) {
    w += d
    s = reduce(plan, s, (k === 'setPace' ? { type: 'setPace', wallMs: w, pace: p } : { type: k, wallMs: w }) as SchedEvent).state
  }
  return { plan, s }
})

describe('K5: session snapshots', () => {
  it('Snapshot.parse(toSnapshot(state)) succeeds and restore gives the same step, start, history and revealed, with elapsed unchanged and no reveal of a revealed note', () => {
    fc.assert(
      fc.property(running, fc.integer({ min: 0, max: 100_000 }), ({ plan, s }, later) => {
        if (s.status !== 'running') return
        const snap = Snapshot.parse(JSON.parse(JSON.stringify(toSnapshot(s, 'r'))))
        const wall = s.lastWall + later
        const r = reduce(plan, initialState, { type: 'restore', wallMs: wall, snapshot: snap })
        expect(r.state.stepIndex).toBe(s.stepIndex)
        expect(r.state.stepStartWall).toBe(s.stepStartWall)
        expect(r.state.paceHistory).toEqual(s.paceHistory)
        expect(r.state.revealed.slice(0, s.revealed.length)).toEqual(s.revealed)
        expect(elapsedMs(r.state, wall)).toBe(elapsedMs(s, wall))
        for (const e of r.effects) if (e.type === 'reveal') expect(s.revealed).not.toContain(e.noteId)
      }),
      { numRuns: 600 },
    )
  })
  it('snapshotValid accepts a snapshot of a running state at a later wall time within the age limit, and rejects the malformed set', () => {
    fc.assert(
      fc.property(running, ({ plan, s }) => {
        if (s.status !== 'running') return
        const snap = toSnapshot(s, 'r')
        const now = s.lastWall + 1
        expect(snapshotValid(snap, plan, 'r', now)).toBe(s.lastWall + 1 - s.stepStartWall <= SESSION_MAX_AGE_MS)
        expect(snapshotValid({ ...snap, recipeId: 'x' }, plan, 'r', now)).toBe(false)
        expect(snapshotValid({ ...snap, stepIndex: plan.steps.length }, plan, 'r', now)).toBe(false)
        expect(snapshotValid({ ...snap, revealed: ['nope'] }, plan, 'r', now)).toBe(false)
        expect(snapshotValid({ ...snap, paceHistory: [{ atWall: snap.stepStartWall + 1, pace: 1 }] }, plan, 'r', now)).toBe(false)
        expect(snapshotValid(snap, plan, 'r', snap.stepStartWall + SESSION_MAX_AGE_MS + 1)).toBe(false)
        expect(snapshotValid(snap, plan, 'r', snap.stepStartWall - 1)).toBe(false)
        if (snap.revealed.length) expect(snapshotValid({ ...snap, revealed: [...snap.revealed, snap.revealed[0]!] }, plan, 'r', now)).toBe(false)
      }),
      { numRuns: 600 },
    )
  })
})
