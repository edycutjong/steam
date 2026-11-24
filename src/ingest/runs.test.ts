import { describe, expect, it } from 'vitest'
import { collectLinePixels, zeroRuns } from './runs.ts'
import { blank, stroke } from './synth.ts'

function pixelsOf(c: { w: number; h: number; ink: Uint8Array }) {
  const owner = new Int16Array(c.w * c.h).fill(-1)
  for (let i = 0; i < owner.length; i++) if (c.ink[i]) owner[i] = 0
  return collectLinePixels(owner, c.w, c.h, 1)[0]!
}

describe('collectLinePixels', () => {
  it('lists the owned pixels of each line in raster order', () => {
    const owner = new Int16Array(3 * 2).fill(-1)
    owner[1] = 0
    owner[3] = 1
    owner[5] = 0
    const [a, b] = collectLinePixels(owner, 3, 2, 2)
    expect([[...a!.xs], [...a!.ys]]).toEqual([[1, 2], [0, 1]])
    expect([[...b!.xs], [...b!.ys]]).toEqual([[0], [1]])
  })
})

describe('zeroRuns (R18.2, R18.3)', () => {
  it('finds runs of at least 4 empty columns inside the ink extent only', () => {
    const c = blank(100, 30)
    for (const x of [10, 11, 12, 20, 21, 40, 41, 42, 43]) stroke(c, x, 5, x, 25, 1)
    const r = zeroRuns(pixelsOf(c), 15, 0)
    expect(r.runs.map((u) => [u.x0, u.x1, u.width])).toEqual([[13, 19, 7], [22, 39, 18]])
    expect(r.runs.map((u) => u.index)).toEqual([0, 1])
    expect(r.lo).toBe(10)
    expect(r.hi).toBe(43)
  })
  it('does not count a gap of 3 columns, counts exactly 4', () => {
    const c = blank(60, 20)
    for (const x of [5, 9, 14]) stroke(c, x, 2, x, 18, 1)
    // gap 6..8 has 3 columns (no run), gap 10..13 has 4 columns (a run)
    expect(zeroRuns(pixelsOf(c), 10, 0).runs.map((u) => [u.x0, u.x1])).toEqual([[10, 13]])
  })
  it('the sheared projection finds a gap that the vertical one loses', () => {
    const c = blank(80, 52)
    stroke(c, 28, 10, 12, 42, 2) // two strokes leaning right, tops 8 px right of their feet
    stroke(c, 38, 10, 22, 42, 2)
    const vertical = zeroRuns(pixelsOf(c), 26, 0)
    const sheared = zeroRuns(pixelsOf(c), 26, 0.5)
    expect(vertical.runs.length).toBe(0)
    expect(sheared.runs.length).toBe(1)
    expect(sheared.runs[0]!.width).toBeGreaterThanOrEqual(4)
  })
  it('returns no runs for an empty line', () => {
    expect(zeroRuns({ xs: new Int32Array(0), ys: new Int32Array(0) }, 0, 0).runs).toEqual([])
  })
})
