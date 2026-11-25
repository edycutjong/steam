import { describe, expect, it } from 'vitest'
import { RevealClock } from './StaticPane.tsx'
import { revealState, THICKEN_MS, WIPE_MS, WRITE_ON_MS, type Phase } from './timeline.ts'

describe('RevealClock with the leads Cook Mode uses (R15.4)', () => {
  it('lead Infinity never starts by itself, and startReveal starts the write-on at once', () => {
    const c = new RevealClock(null, Infinity, 0)
    for (const now of [0, 3_000, 1e9]) expect(c.state(now).phase).toBe('fogged')
    c.startReveal(5_000)
    expect(c.state(5_000).phase).toBe('writing')
    expect(c.state(5_000 + WRITE_ON_MS - 1).phase).toBe('writing')
    expect(c.state(5_000 + WRITE_ON_MS).phase).toBe('holding')
  })
  it('a negative lead of -WRITE_ON_MS is holding from the first frame, and can be wiped', () => {
    const c = new RevealClock(null, -WRITE_ON_MS, 10_000)
    expect(c.state(10_000).phase).toBe('holding')
    expect(c.state(10_000).u).toBe(1)
    c.wipe(10_100)
    expect(c.state(10_100).phase).toBe('wiped')
    expect(c.state(10_100 + WIPE_MS).wipe).toBe(1)
  })
  it('a held pane ignores startReveal until it is wiped', () => {
    const c = new RevealClock(null, -WRITE_ON_MS, 0)
    c.startReveal(1_000)
    expect(c.state(1_000).phase).toBe('holding')
  })
})

// cook-mode-qa-r1 Q8: after a lost WebGL context the static pane carries on from the phase the renderer was in
describe('RevealClock.resume: the static pane continues the live reveal (Q8)', () => {
  const at = (tMs: number, wipeAtMs: number | null = null) => revealState(tMs, wipeAtMs)
  const cases: [Phase, number, number | null][] = [
    ['thickening', -600, null],
    ['writing', 2000, null],
    ['holding', WRITE_ON_MS + 3000, null],
    ['wiped', WRITE_ON_MS + 600, WRITE_ON_MS],
  ]
  it.each(cases)('%s: resumes in the same phase, at the same place', (phase, t, wipeAt) => {
    const st = at(t, wipeAt)
    expect(st.phase).toBe(phase)
    const c = RevealClock.resume(st, 1_000, 1_000)
    const back = c.state(1_000)
    expect(back.phase).toBe(phase)
    expect(back.u).toBeCloseTo(st.u, 3)
    expect(back.thicken).toBeCloseTo(st.thicken, 3)
    expect(back.wipe).toBeCloseTo(st.wipe, 3)
  })
  it('the time since the last state counts: a writing pane resumed 2 s later is 2 s further on and reaches holding on time', () => {
    const st = at(1000)
    const c = RevealClock.resume(st, 10_000, 12_000)
    expect(c.state(12_000).u).toBeCloseTo(3000 / WRITE_ON_MS, 3)
    expect(c.state(12_000 + WRITE_ON_MS - 3000 - 1).phase).toBe('writing')
    expect(c.state(12_000 + WRITE_ON_MS - 3000).phase).toBe('holding')
  })
  it('a held pane stays held for good and can be wiped; a wiped pane stays wiped', () => {
    const held = RevealClock.resume(at(WRITE_ON_MS + 10), 0, 60_000)
    expect(held.state(60_000).phase).toBe('holding')
    held.wipe(60_100)
    expect(held.state(60_100).phase).toBe('wiped')
    expect(held.state(60_100 + WIPE_MS).wipe).toBe(1)
    const wiped = RevealClock.resume(at(WRITE_ON_MS + WIPE_MS + 5000, WRITE_ON_MS), 0, 100)
    expect(wiped.state(100).phase).toBe('wiped')
    expect(wiped.state(100).wipe).toBe(1)
  })
  it('a fogged pane that was never started stays fogged and starts on startReveal', () => {
    const c = RevealClock.resume(at(-5000), 0, 9_000)
    expect(c.state(9_000).phase).toBe('fogged')
    expect(c.state(1e9).phase).toBe('fogged')
    c.startReveal(9_500)
    expect(c.state(9_500).phase).toBe('writing')
    expect(THICKEN_MS).toBeGreaterThan(0)
  })
})
