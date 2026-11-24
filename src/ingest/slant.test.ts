import { describe, expect, it } from 'vitest'
import { estimateSlant, shear, unshear } from './slant.ts'
import { blank, textRow, stroke } from './synth.ts'

function pageWithSlant(slant: number) {
  const c = blank(600, 420)
  const mids = new Float64Array(c.h)
  const ycs = [80, 170, 260, 350]
  for (const yc of ycs) textRow(c, { yc, hh: 16, x0: 30, words: [5, 4, 6, 5], gap: 14, slant })
  for (let y = 0; y < c.h; y++) mids[y] = ycs.reduce((b, v) => (Math.abs(v - y) < Math.abs(b - y) ? v : b), ycs[0]!)
  return { c, mids }
}

describe('estimateSlant', () => {
  for (const s of [0.2, 0.4, -0.2]) {
    it(`gives the sign and size of a ${s} lean within one step`, () => {
      const { c, mids } = pageWithSlant(s)
      const r = estimateSlant(c.ink, c.w, c.h, mids)
      expect(Math.sign(r.s)).toBe(Math.sign(s))
      expect(Math.abs(r.s - s)).toBeLessThanOrEqual(0.05 + 1e-9)
      expect(r.vertical).toBe(false)
    })
  }
  it('reports vertical strokes as 0', () => {
    const c = blank(200, 100)
    const mids = new Float64Array(100).fill(50)
    for (let x = 10; x < 190; x += 9) stroke(c, x, 20, x, 80, 2)
    const r = estimateSlant(c.ink, c.w, c.h, mids)
    expect(r.s).toBe(0)
    expect(r.vertical).toBe(true)
  })
  it('stays inside the search range', () => {
    const { c, mids } = pageWithSlant(0.8)
    const r = estimateSlant(c.ink, c.w, c.h, mids)
    expect(r.s).toBeLessThanOrEqual(0.8)
    expect(r.s).toBeGreaterThanOrEqual(-0.5)
  })
})

describe('shear', () => {
  it('x\' = x - s (yMid - y), and unshear is its inverse', () => {
    expect(shear(100, 40, 50, 0.3)).toBeCloseTo(97, 10)
    expect(shear(100, 60, 50, 0.3)).toBeCloseTo(103, 10)
    for (const [x, y, m, s] of [[10, 3, 20, 0.45], [500, 900, 880, -0.2]] as const) expect(unshear(shear(x, y, m, s), y, m, s)).toBeCloseTo(x, 9)
  })
  it('un-leans a right-leaning stroke: its x\' is constant', () => {
    const s = 0.4
    const xs = [0, 10, 20].map((dy) => shear(100 + s * (20 - dy), dy, 20, s))
    expect(new Set(xs.map((v) => Math.round(v * 1e9)))).toEqual(new Set([Math.round(100 * 1e9)]))
  })
})
