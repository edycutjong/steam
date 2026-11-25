import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { DARK_A, CLEAR_A, MAX_RUNS, MIN_RUNS, MIN_SPACING_PX, NARROW_RUNS, RUN_LEN_H, RUN_SPACING_CSS, SILL_CLEARANCE_CSS, WIDE_RUNS, dripDistance, dripEnd, placeDrips, planDrips } from './drips.ts'
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
  it('plans 3 to 6 candidate runs', () => {
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

describe('placeDrips (R13.1, R13.2, R13.6)', () => {
  const plan = planDrips(input, 7)
  const meta1 = { size: meta.size, groups: meta.groups }
  const cases = [
    ['desktop', 'page', 1236, 345, WIDE_RUNS],
    ['phone 373', 'groups', 373, 460, NARROW_RUNS],
    ['phone 369', 'groups', 369, 460, NARROW_RUNS],
  ] as const
  for (const [name, kind, pw, ph, [lo, hi]] of cases) {
    it(`${name}: places ${lo} to ${hi} runs that start no earlier than their stroke is written, stop above the sill and keep apart`, () => {
      const layout = computeLayout(kind, pw, ph, meta1)
      for (const seed of [7, 8, 9, 10, 11, 12]) {
        const runs = placeDrips(planDrips(input, seed), layout, pw, ph, seed)
        expect(runs.length).toBeGreaterThanOrEqual(Math.min(lo, 1))
        expect(runs.length).toBeLessThanOrEqual(hi)
        for (const r of runs) {
          expect(r.tStart).toBeGreaterThanOrEqual(r.u0 * WRITE_ON_MS)
          expect(r.y0 + r.len).toBeLessThanOrEqual(ph - SILL_CLEARANCE_CSS + 1e-6)
          expect(dripDistance(r, dripEnd(r) + 1e4)).toBeLessThanOrEqual(r.len + 1e-9)
        }
        for (const a of runs) for (const b of runs) if (a !== b) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(RUN_SPACING_CSS)
      }
    })
    it(`${name}: lengths are 0.5 to 2 core bands, at most one longer (up to 3.2)`, () => {
      const layout = computeLayout(kind, pw, ph, meta1)
      const H = Math.min(...layout.groups.map((g) => g.coreBandCssPx))
      const Hmax = Math.max(...layout.groups.map((g) => g.coreBandCssPx))
      for (const seed of [7, 8, 9, 10, 11, 12, 13, 14]) {
        const runs = placeDrips(planDrips(input, seed), layout, pw, ph, seed)
        const long = runs.filter((r) => r.len > RUN_LEN_H.short * Hmax + 1e-6)
        expect(long.length).toBeLessThanOrEqual(1)
        for (const r of runs) {
          expect(r.len).toBeLessThanOrEqual(RUN_LEN_H.long * Hmax + 1e-6)
          // a run short of its minimum length is only one that ran out of room
          if (r.len < RUN_LEN_H.min * H - 1e-6) expect(r.y0 + r.len).toBeGreaterThan(0)
        }
      }
    })
  }
  it('scales with the pane: a phone has thinner channels and a smaller bead than the desktop, and the bead is at least 1.6 half-widths', () => {
    const d = placeDrips(plan, computeLayout('page', 1236, 345, meta1), 1236, 345, 7)
    const p = placeDrips(plan, computeLayout('groups', 373, 460, meta1), 373, 460, 7)
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(p.map((r) => r.halfWidth))).toBeLessThan(mean(d.map((r) => r.halfWidth)))
    expect(mean(p.map((r) => r.headR))).toBeLessThanOrEqual(mean(d.map((r) => r.headR)))
    for (const r of [...d, ...p]) expect(r.headR).toBeGreaterThanOrEqual(1.6 * r.halfWidth)
  })
  it('moves by accelerating then stalling: the head covers most of its length within its slide, and is still after the end', () => {
    const layout = computeLayout('page', 1236, 345, meta1)
    const r = placeDrips(plan, layout, 1236, 345, 7).sort((a, b) => b.len - a.len)[0]
    expect(dripDistance(r, r.tStart)).toBe(0)
    const end = dripEnd(r)
    expect(dripDistance(r, end + 5000)).toBeCloseTo(dripDistance(r, end + 9000), 9)
    // within its first slide the head has not covered more than 45 % of that slide's length after a quarter of its time
    expect(dripDistance(r, r.tStart + r.dur1 * 0.25)).toBeLessThan(0.45 * r.len1)
  })
})
