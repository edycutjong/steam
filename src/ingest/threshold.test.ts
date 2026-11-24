import { describe, expect, it } from 'vitest'
import type { Gray } from './image.ts'
import { inkMap, rawInk, sauvola } from './threshold.ts'

const gray = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x, y))))
  return { width: w, height: h, data }
}
const count = (a: Uint8Array) => a.reduce((s, v) => s + (v ? 1 : 0), 0)

describe('threshold', () => {
  it('a uniform image has no ink', () => {
    const g = gray(80, 60, () => 190)
    expect(count(inkMap(g))).toBe(0)
    expect(count(rawInk(g))).toBe(0)
  })

  it('finds a dark stroke on a left-to-right gradient at both ends', () => {
    const g = gray(300, 80, (x, y) => (y >= 38 && y < 42 && (x < 12 || x >= 288) ? 60 + (x < 12 ? 0 : 170) * 0 : 120 + x * 0.4))
    // stroke is 60 gray at both ends; background rises from 120 to 240
    const ink = inkMap(g)
    expect(ink[40 * 300 + 5]).toBe(1)
    expect(ink[40 * 300 + 295]).toBe(1)
    expect(ink[10 * 300 + 150]).toBe(0)
  })

  it('is unchanged when every pixel is shifted by a constant that keeps the range', () => {
    const base = gray(120, 60, (x, y) => (y === 30 && x > 20 && x < 100 ? 80 : 170 + ((x * 7 + y * 3) % 5)))
    const shifted: Gray = { ...base, data: base.data.map((v) => v + 20) }
    expect([...inkMap(shifted)]).toEqual([...inkMap(base)])
  })

  it('clips the window at the borders (a stroke on the very first column is ink)', () => {
    const g = gray(60, 60, (x) => (x === 0 ? 40 : 200))
    const ink = inkMap(g, { window: 41 })
    expect(ink[30 * 60]).toBe(1)
    const t = sauvola(g, 41)
    expect(Number.isFinite(t[0])).toBe(true)
  })

  it('rawInk is a superset of inkMap, and the median guard removes ink-like texture on a dark page', () => {
    // 60% of the page is dark binding (gray 20), the rest paper with faint texture lines (gray 185 on 235)
    const g = gray(100, 60, (x, y) => (x < 60 ? 20 : y % 6 === 0 ? 185 : 235))
    const raw = rawInk(g)
    const ink = inkMap(g)
    for (let i = 0; i < raw.length; i++) if (ink[i]) expect(raw[i]).toBe(1)
    expect(raw[6 * 100 + 80]).toBe(1)
    expect(ink[6 * 100 + 80]).toBe(0)
    expect(count(raw)).toBeGreaterThan(count(ink))
    // against the paper's own median the same pixels are ink
    expect(inkMap(g, { region: { x0: 70, y0: 0, x1: 100, y1: 60 } })[6 * 100 + 80]).toBe(1)
  })

  it('takes the median guard from the given region only', () => {
    const g = gray(100, 40, (x, y) => (x < 50 ? 30 : y === 20 ? 120 : 220))
    const ink = inkMap(g, { region: { x0: 50, y0: 0, x1: 100, y1: 40 } })
    expect(ink[20 * 100 + 70]).toBe(1)
  })
})
