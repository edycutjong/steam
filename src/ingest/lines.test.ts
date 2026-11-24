import { describe, expect, it } from 'vitest'
import { findLines, rowProfile } from './lines.ts'
import { blank, mulberry32, textRow } from './synth.ts'

function page(n: number, pitch: number, hh = 14, top = 60, w = 400) {
  const c = blank(w, top + n * pitch + 40)
  const rnd = mulberry32(7)
  const truth: number[] = []
  for (let i = 0; i < n; i++) {
    const yc = top + i * pitch
    truth.push(yc)
    textRow(c, { yc, hh, x0: 20, words: [4, 3, 5, 4 + Math.floor(rnd() * 3), 3], gap: 14, slant: 0.2 })
  }
  return { c, truth }
}

describe('rowProfile', () => {
  it('counts ink pixels per row inside the column window', () => {
    const w = 10
    const ink = new Uint8Array(w * 3)
    ink.set([1, 1, 1], 0)
    ink.set([1, 0, 0, 1], w)
    expect([...rowProfile(ink, w, 3, 0, 2)]).toEqual([2, 1, 0])
    expect([...rowProfile(ink, w, 3)]).toEqual([3, 2, 0])
  })
})

describe('findLines', () => {
  it('finds N lines with peaks within 3 rows of the truth (R8.6)', () => {
    const { c, truth } = page(9, 62)
    const r = findLines(rowProfile(c.ink, c.w, c.h))
    expect(r.lines.length).toBe(9)
    r.lines.forEach((l, i) => expect(Math.abs(l.peakRow - truth[i]!)).toBeLessThanOrEqual(3))
  })
  it('sets the core band to the rows at or above 60% of the smoothed peak', () => {
    const { c } = page(4, 70)
    const r = findLines(rowProfile(c.ink, c.w, c.h))
    for (const l of r.lines) {
      const p = r.profile[l.peakRow]!
      for (let y = l.core[0]; y <= l.core[1]; y++) expect(r.profile[y]!).toBeGreaterThanOrEqual(0.6 * p - 1e-9)
      expect(l.core[0]).toBeLessThanOrEqual(l.peakRow)
      expect(l.core[1]).toBeGreaterThanOrEqual(l.peakRow)
    }
  })
  it('puts the valley at the minimum between neighbours (lowest index on a tie) and cores never overlap', () => {
    const { c } = page(5, 66)
    const r = findLines(rowProfile(c.ink, c.w, c.h))
    expect(r.valleys.length).toBe(4)
    for (let i = 0; i < r.valleys.length; i++) {
      const v = r.valleys[i]!
      expect(v).toBeGreaterThan(r.lines[i]!.core[1])
      expect(v).toBeLessThan(r.lines[i + 1]!.core[0])
      for (let y = r.lines[i]!.peakRow + 1; y < r.lines[i + 1]!.peakRow; y++) {
        if (y < v) expect(r.profile[y]!).toBeGreaterThan(r.profile[v]!)
        else expect(r.profile[y]!).toBeGreaterThanOrEqual(r.profile[v]!)
      }
    }
  })
  it('keeps only the higher of two peaks closer than 40 rows', () => {
    const prof = new Float64Array(200)
    prof[50] = 100
    prof[70] = 60
    prof[150] = 90
    const r = findLines(prof, 1, 0.5)
    expect(r.lines.map((l) => l.peakRow)).toEqual([50, 150])
  })
  it('ignores peaks under 25% of the global maximum', () => {
    const prof = new Float64Array(300)
    prof[40] = 100
    prof[140] = 20
    prof[240] = 90
    const r = findLines(prof, 1, 0.5)
    expect(r.lines.length).toBe(2)
  })
  it('reports the median peak distance as the line pitch', () => {
    const { c } = page(7, 64)
    const r = findLines(rowProfile(c.ink, c.w, c.h))
    expect(Math.abs(r.pitch - 64)).toBeLessThanOrEqual(3)
  })
  it('returns no lines for an empty profile', () => {
    expect(findLines(new Float64Array(50)).lines).toEqual([])
  })
})
