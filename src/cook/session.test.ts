import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import { initialState, reduce, toSnapshot } from './scheduler.ts'
import { SESSION_MAX_AGE_MS, Snapshot, snapshotValid } from './session.ts'

const plan: Plan = { steps: [{ note: { id: 'a', checkAtMs: 0 } }, { note: null }, { note: { id: 'c', checkAtMs: 0 } }] }
const NOW = 1_000_000_000
const running = reduce(plan, initialState, { type: 'start', wallMs: NOW - 5_000, pace: 1 }).state
const good = toSnapshot(reduce(plan, running, { type: 'setPace', wallMs: NOW - 2_000, pace: 4 }).state, 'r1')

describe('Snapshot and snapshotValid (R18.2, R18.3)', () => {
  it('accepts a real toSnapshot and finds it valid', () => {
    expect(Snapshot.safeParse(good).success).toBe(true)
    expect(snapshotValid(good, plan, 'r1', NOW)).toBe(true)
  })
  const bad: [string, (s: Snapshot) => Snapshot][] = [
    ['wrong recipe', (s) => ({ ...s, recipeId: 'other' })],
    ['step out of range', (s) => ({ ...s, stepIndex: 3 })],
    ['history not starting at stepStartWall', (s) => ({ ...s, paceHistory: [{ atWall: s.stepStartWall + 1, pace: 1 }] })],
    ['history going backwards', (s) => ({ ...s, paceHistory: [{ atWall: s.stepStartWall, pace: 1 }, { atWall: s.stepStartWall + 10, pace: 4 }, { atWall: s.stepStartWall + 5, pace: 12 }] })],
    ['unknown note id', (s) => ({ ...s, revealed: ['zzz'] })],
    ['repeated id', (s) => ({ ...s, revealed: ['a', 'a'] })],
    ['older than SESSION_MAX_AGE_MS', (s) => ({ ...s, stepStartWall: NOW - SESSION_MAX_AGE_MS - 1, paceHistory: [{ atWall: NOW - SESSION_MAX_AGE_MS - 1, pace: 1 }] })],
    ['in the future', (s) => ({ ...s, stepStartWall: NOW + 1, paceHistory: [{ atWall: NOW + 1, pace: 1 }] })],
  ]
  it.each(bad)('rejects %s', (_n, edit) => expect(snapshotValid(edit(good), plan, 'r1', NOW)).toBe(false))
  it('accepts the edges of the age window', () => {
    const edge = { ...good, stepStartWall: NOW - SESSION_MAX_AGE_MS, paceHistory: [{ atWall: NOW - SESSION_MAX_AGE_MS, pace: 1 as const }] }
    expect(snapshotValid(edge, plan, 'r1', NOW)).toBe(true)
  })
  it('the schema rejects an unknown pace, a missing field and a stray key', () => {
    expect(Snapshot.safeParse({ ...good, paceHistory: [{ atWall: 1, pace: 7 }] }).success).toBe(false)
    const { revealed: _r, ...noRevealed } = good
    void _r
    expect(Snapshot.safeParse(noRevealed).success).toBe(false)
    expect(Snapshot.safeParse({ ...good, extra: 1 }).success).toBe(false)
    expect(Snapshot.safeParse(JSON.parse(JSON.stringify(good))).success).toBe(true)
  })
})
