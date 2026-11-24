import { describe, expect, it } from 'vitest'
import {
  GROUP_GAP_CSS,
  MIN_CORE_CSS_PX,
  PAD_PX,
  S_MAX,
  chooseLayout,
  computeLayout,
  type LayoutMeta,
} from './layout.ts'

export const heroMeta: LayoutMeta = {
  size: [1251, 177],
  groups: [
    { rect: [781, 32, 1219, 93], coreBand: [46, 81], t: [0, 0.485] },
    { rect: [31, 85, 496, 145], coreBand: [109, 143], t: [0.485, 1] },
  ],
}

describe('chooseLayout', () => {
  it('uses groups at or below 640 and page above', () => {
    expect(chooseLayout(390)).toBe('groups')
    expect(chooseLayout(640)).toBe('groups')
    expect(chooseLayout(641)).toBe('page')
    expect(chooseLayout(1440)).toBe('page')
  })
  it('changes kind when resizing across 640', () => {
    expect(chooseLayout(700)).not.toBe(chooseLayout(600))
  })
})

describe('phone layout', () => {
  for (const [w, h] of [
    [390, 500],
    [360, 480],
  ]) {
    it(`fits at ${w} px wide`, () => {
      const l = computeLayout('groups', w, h, heroMeta)
      expect(l.kind).toBe('groups')
      expect(l.fits).toBe(true)
      expect(l.groups.map((g) => g.index)).toEqual([0, 1])
      for (const g of l.groups) {
        expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
        expect(g.inked[2] + PAD_PX).toBeLessThanOrEqual(w + 1e-9)
        expect(g.inked[0]).toBeGreaterThanOrEqual(PAD_PX - 1e-9)
        expect(g.scale).toBeLessThanOrEqual(S_MAX)
      }
      const [a, b] = l.groups
      expect(b.inked[1] - a.inked[3]).toBeGreaterThanOrEqual(GROUP_GAP_CSS - 1e-9)
    })
  }
  it('uses paneW - 2*PAD_PX over the rect width at 390', () => {
    const [a, b] = computeLayout('groups', 390, 500, heroMeta).groups
    expect(a.scale).toBeCloseTo(358 / 438, 6)
    expect(b.scale).toBeCloseTo(358 / 465, 6)
  })
  it('clamps src to the note size and inflates by the margin', () => {
    const [a, b] = computeLayout('groups', 390, 500, heroMeta).groups
    expect(a.src).toEqual([749, 0, 1251, 125])
    expect(b.src).toEqual([0, 53, 528, 177])
  })
  it('flags fits=false on very narrow panes but keeps the core band', () => {
    const l = computeLayout('groups', 200, 500, heroMeta)
    expect(l.fits).toBe(false)
    for (const g of l.groups) expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX - 1e-9)
  })
})

describe('desktop layout', () => {
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
    [800, 600],
  ]) {
    it(`keeps page geometry at ${w}x${h}`, () => {
      const l = computeLayout('page', w, h, heroMeta)
      expect(l.kind).toBe('page')
      expect(l.fits).toBe(true)
      const [a, b] = l.groups
      expect(a.scale).toBe(b.scale)
      expect(a.scale).toBeLessThanOrEqual(S_MAX)
      for (const g of l.groups) {
        expect(g.inked[0]).toBeGreaterThanOrEqual(0)
        expect(g.inked[2]).toBeLessThanOrEqual(w)
        expect(g.inked[3]).toBeLessThanOrEqual(h)
      }
      // group B is left of and lower than group A, as on the page
      const s = a.scale
      expect(a.inked[0] - b.inked[0]).toBeCloseTo((781 - 31) * s, 6)
      expect(b.inked[1] - a.inked[1]).toBeCloseTo((85 - 32) * s, 6)
    })
  }
})
