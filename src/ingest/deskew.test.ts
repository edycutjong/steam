import { describe, expect, it } from 'vitest'
import { applyDeskew, estimateTilt } from './deskew.ts'
import type { Gray } from './image.ts'
import { inkMap } from './threshold.ts'
import { findLines, rowProfile } from './lines.ts'
import { blank, mulberry32, textRow, type Canvas } from './synth.ts'

export function ruledText(tilt: number, n = 6, w = 700, pitch = 80): Canvas {
  const c = blank(w, 100 + n * pitch)
  const rnd = mulberry32(3)
  for (let i = 0; i < n; i++)
    textRow(c, { yc: 70 + i * pitch, hh: 14, x0: 30, words: [4, 3, 5, 4, 3, 4, 3], gap: 12 + Math.floor(rnd() * 3), slant: 0.2, tilt })
  return c
}
const toGrayPage = (c: Canvas): Gray => ({ width: c.w, height: c.h, data: c.ink.map((v) => (v ? 40 : 235)) })

describe('estimateTilt', () => {
  for (const t of [-4, -1, 0, 0.3, 0.7, 3]) {
    it(`finds ${t} degrees within 0.2`, () => {
      const c = ruledText(t)
      expect(Math.abs(estimateTilt(c.ink, c.w, c.h) - t)).toBeLessThanOrEqual(0.2)
    })
  }
  it('returns 0 for an empty page', () => {
    expect(estimateTilt(new Uint8Array(100), 10, 10)).toBe(0)
  })
})

describe('applyDeskew', () => {
  it('records but does not apply angles under 0.5 degrees', () => {
    const g = toGrayPage(ruledText(0.3))
    const r = applyDeskew(g, 0.3)
    expect(r.applied).toBe(false)
    expect(r.gray.data).toEqual(g.data)
    expect(r.deg).toBe(0.3)
  })
  it('straightens a tilted page: the line count is recovered', () => {
    const c = ruledText(3)
    const g = toGrayPage(c)
    const est = estimateTilt(c.ink, c.w, c.h)
    const r = applyDeskew(g, est)
    expect(r.applied).toBe(true)
    const ink = inkMap(r.gray)
    expect(findLines(rowProfile(ink, g.width, g.height)).lines.length).toBe(6)
    // and the page was resampled, so the data changed
    expect(r.gray.data).not.toEqual(g.data)
  })
})
