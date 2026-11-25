import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { DARK_A, CLEAR_A, MAX_RUNS, MIN_RUNS, MIN_SPACING_PX, SILL_CLEARANCE_CSS, dripDistance, dripEnd, placeDrips, planDrips } from './drips.ts'
import type { PlanInput } from './drips.ts'
import { computeLayout } from './layout.ts'
import { WRITE_ON_MS } from './timeline.ts'

const dir = new URL('../../public/recipes/quinces-marmalade/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('note-till-it-looks-red-smooth.json', dir), 'utf8')) as {
  size: [number, number]
  groups: { rect: [number, number, number, number]; coreBand: [number, number]; t: [number, number] }[]
}
const toi = PNG.sync.read(readFileSync(new URL('note-till-it-looks-red-smooth.toi.png', dir)))
const w = toi.width
const h = toi.height
const ink = new Uint8Array(w * h)
for (let p = 0; p < w * h; p++) ink[p] = toi.data[p * 4]
export const input: PlanInput = { ink, toi: toi.data, width: w, height: h, groups: meta.groups }

describe('planDrips on the hero note (P-D3)', () => {
  const plan = planDrips(input, 7)
  it('plans 3 to 6 runs', () => {
    expect(plan.length).toBeGreaterThanOrEqual(MIN_RUNS)
    expect(plan.length).toBeLessThanOrEqual(MAX_RUNS)
  })
  it('is the same plan for the same seed and a different one for another seed', () => {
    expect(planDrips(input, 7)).toEqual(plan)
    expect(planDrips(input, 8).map((r) => r.delayMs)).not.toEqual(plan.map((r) => r.delayMs))
  })
  it('starts every run on dark ink with clear glass below, inside its group', () => {
    for (const r of plan) {
      const x = Math.floor(r.x)
      const yb = Math.floor(r.y) - 1
      expect(ink[yb * w + x]).toBeGreaterThanOrEqual(DARK_A)
      for (let k = 1; k <= 3; k++) expect(ink[(yb + k) * w + x]).toBeLessThan(CLEAR_A)
      const [x0, y0, x1, y1] = meta.groups[r.group].rect
      expect(x).toBeGreaterThanOrEqual(x0)
      expect(x).toBeLessThan(x1)
      expect(yb).toBeGreaterThanOrEqual(y0)
      expect(yb).toBeLessThanOrEqual(y1)
    }
  })
  it('keeps runs of one group at least 90 note px apart, and picks heavy strokes', () => {
    for (const a of plan) for (const b of plan) if (a !== b && a.group === b.group) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(MIN_SPACING_PX)
    expect(Math.min(...plan.map((r) => r.mass))).toBeGreaterThan(4)
  })
})

describe('placeDrips', () => {
  const plan = planDrips(input, 7)
  const meta1 = { size: meta.size, groups: meta.groups }
  for (const [name, kind, pw, ph] of [['desktop', 'page', 1236, 345], ['phone', 'groups', 373, 230]] as const) {
    it(`${name}: places 3 or more runs that start no earlier than their stroke is written and stop above the sill`, () => {
      const layout = computeLayout(kind, pw, ph, meta1)
      const runs = placeDrips(plan, layout, pw, ph, 7)
      expect(runs.length).toBeGreaterThanOrEqual(3)
      for (const r of runs) {
        expect(r.tStart).toBeGreaterThanOrEqual(r.u0 * WRITE_ON_MS)
        expect(r.y0 + r.len).toBeLessThanOrEqual(ph - SILL_CLEARANCE_CSS + 1e-6)
        expect(dripDistance(r, dripEnd(r) + 1e4)).toBeLessThanOrEqual(r.len + 1e-9)
      }
    })
  }
  it('moves by accelerating then stalling: the head covers most of its length within its slide, and is still after the end', () => {
    const layout = computeLayout('page', 1236, 345, meta1)
    const r = placeDrips(plan, layout, 1236, 345, 7)[0]
    expect(dripDistance(r, r.tStart)).toBe(0)
    const end = dripEnd(r)
    expect(dripDistance(r, end + 5000)).toBeCloseTo(dripDistance(r, end + 9000), 9)
    const quarter = dripDistance(r, r.tStart + (end - r.tStart) * 0.25)
    expect(quarter).toBeLessThan(0.45 * r.len)
  })
})
