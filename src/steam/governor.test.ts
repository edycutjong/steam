import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GOV_IGNORE_MS, GOV_P95_MS, GOV_WINDOW, MAX_TIER, QualityGovernor, governorEnabled } from './governor.ts'

function feed(g: QualityGovernor, n: number, dt: number): Array<number | null> {
  const out: Array<number | null> = []
  for (let i = 0; i < n; i++) out.push(g.push(dt))
  return out
}

describe('QualityGovernor', () => {
  it('stays at tier 0 at 60 fps', () => {
    const g = new QualityGovernor()
    feed(g, 600, 16.7)
    expect(g.tier).toBe(0)
  })
  it('raises the tier by one when a full window has a p95 over 18 ms, and restarts the window', () => {
    const g = new QualityGovernor()
    const r = feed(g, GOV_WINDOW, 22)
    expect(r.filter((x) => x !== null)).toEqual([1])
    expect(r[GOV_WINDOW - 1]).toBe(1)
    expect(g.tier).toBe(1)
    expect(g.filled).toBe(0)
    feed(g, GOV_WINDOW - 1, 22)
    expect(g.tier).toBe(1) // not before another full window
    g.push(22)
    expect(g.tier).toBe(2)
  })
  it('walks 1, 2, 3 and stops at 3', () => {
    const g = new QualityGovernor()
    feed(g, GOV_WINDOW * 8, 40)
    expect(g.tier).toBe(MAX_TIER)
  })
  it('needs at least four slow frames in a window: three do not trigger it', () => {
    const g = new QualityGovernor()
    for (let i = 0; i < GOV_WINDOW; i++) g.push(i < 3 ? 60 : 16.7)
    expect(g.tier).toBe(0)
    const h = new QualityGovernor()
    for (let i = 0; i < GOV_WINDOW; i++) h.push(i < 4 ? 60 : 16.7)
    expect(h.tier).toBe(1)
  })
  // a2a-arch-r05 B2 changed this test on purpose. It pushed 501 and 5000 back to back and expected silence for ever; two long
  // intervals in a row are still silent, but three would now raise the tier (see the stall tests), so a normal frame now
  // separates each long one, and the test says what it still means: a lone long interval is not entered in the window.
  it('does not enter a lone interval over 500 ms in the window, and ignores non-positive or non-finite ones', () => {
    const g = new QualityGovernor()
    for (const dt of [GOV_IGNORE_MS + 1, 5000]) {
      expect(g.push(dt)).toBeNull()
      expect(g.push(16.7)).toBeNull()
    }
    expect(g.filled).toBe(2)
    for (const dt of [0, -3, NaN, Infinity]) expect(g.push(dt)).toBeNull()
    expect(g.filled).toBe(2)
    expect(g.tier).toBe(0)
  })
  it('uses 18 ms as the budget', () => {
    expect(GOV_P95_MS).toBe(18)
    const g = new QualityGovernor()
    feed(g, GOV_WINDOW, 18)
    expect(g.tier).toBe(0)
  })
})

describe('QualityGovernor stall path (a2a-arch-r05 B2)', () => {
  const LONG = GOV_IGNORE_MS + 1
  it('three consecutive visible intervals over 500 ms raise the tier straight to 3', () => {
    const g = new QualityGovernor()
    expect(g.push(LONG)).toBeNull()
    expect(g.push(900)).toBeNull()
    expect(g.push(5000)).toBe(3)
    expect(g.tier).toBe(3)
  })
  it('jumps from a lower tier too, and says nothing once at tier 3', () => {
    const g = new QualityGovernor()
    feed(g, GOV_WINDOW, 22)
    expect(g.tier).toBe(1)
    g.push(LONG)
    g.push(LONG)
    expect(g.push(LONG)).toBe(3)
    expect(g.push(LONG)).toBeNull()
    expect(g.tier).toBe(3)
  })
  it('one long interval, or long ones broken up by a normal frame, change nothing', () => {
    const g = new QualityGovernor()
    for (let i = 0; i < 40; i++) {
      g.push(LONG)
      g.push(LONG)
      g.push(16.7)
    }
    expect(g.tier).toBe(0)
  })
  it('a long interval is not entered in the 60-frame window', () => {
    const g = new QualityGovernor()
    g.push(16.7)
    g.push(LONG)
    expect(g.filled).toBe(1)
  })
  it('non-finite and non-positive intervals are not stalls and do not break a run', () => {
    const g = new QualityGovernor()
    g.push(LONG)
    for (const dt of [NaN, -1, 0, Infinity]) expect(g.push(dt)).toBeNull()
    g.push(LONG)
    expect(g.push(LONG)).toBe(3)
  })
  it('P-G1b: three consecutive long intervals always end at tier 3', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: LONG, max: 1e6, noNaN: true }), { minLength: 3, maxLength: 8 }), fc.integer({ min: 0, max: 100 }), (longs, lead) => {
        const g = new QualityGovernor()
        for (let i = 0; i < lead; i++) g.push(16.7)
        for (const l of longs) g.push(l)
        return g.tier === 3
      }),
    )
  })
})

describe('QualityGovernor (P-G1)', () => {
  it('never lowers the tier, whatever the intervals', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -5, max: 2000, noNaN: true }), { maxLength: 800 }), (dts) => {
        const g = new QualityGovernor()
        let prev = 0
        for (const dt of dts) {
          g.push(dt)
          if (g.tier < prev) return false
          prev = g.tier
        }
        return true
      }),
    )
  })
  it('a single long frame of any duration never raises the tier', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 1e6, noNaN: true }), fc.integer({ min: 0, max: 200 }), (long, at) => {
        const g = new QualityGovernor()
        for (let i = 0; i < 300; i++) g.push(i === at ? long : 16.7)
        return g.tier === 0
      }),
    )
  })
  it('three long frames in a window never raise the tier', () => {
    fc.assert(
      fc.property(fc.double({ min: 19, max: 400, noNaN: true }), fc.array(fc.integer({ min: 0, max: GOV_WINDOW - 1 }), { minLength: 3, maxLength: 3 }), (long, idx) => {
        const g = new QualityGovernor()
        const slow = new Set(idx)
        for (let i = 0; i < GOV_WINDOW; i++) g.push(slow.has(i) ? long : 16.7)
        return g.tier === 0 || slow.size > 3
      }),
    )
  })
})

describe('governorEnabled', () => {
  it('is on for people and off for automation unless gov=1 asks for it', () => {
    expect(governorEnabled('', '#/', false)).toBe(true)
    expect(governorEnabled('', '#/', true)).toBe(false)
    expect(governorEnabled('', '#/pane/a/b?t=1&gov=1', true)).toBe(true)
    expect(governorEnabled('?gov=1', '', true)).toBe(true)
    expect(governorEnabled('', '#/pane/a/b?gov=0', false)).toBe(false)
    expect(governorEnabled('?gov=10', '', true)).toBe(false)
  })
})
