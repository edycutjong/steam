import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GOV_IGNORE_MS, GOV_P95_MS, GOV_WINDOW, MAX_TIER, QualityGovernor } from './governor.ts'

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
  it('ignores intervals over 500 ms and non-positive or non-finite ones', () => {
    const g = new QualityGovernor()
    for (const dt of [GOV_IGNORE_MS + 1, 5000, 0, -3, NaN, Infinity]) expect(g.push(dt)).toBeNull()
    expect(g.filled).toBe(0)
  })
  it('uses 18 ms as the budget', () => {
    expect(GOV_P95_MS).toBe(18)
    const g = new QualityGovernor()
    feed(g, GOV_WINDOW, 18)
    expect(g.tier).toBe(0)
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
