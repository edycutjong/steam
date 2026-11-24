import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { nearestBand, ownership, type Bands } from './masks.ts'

/** Three bands: cores [10,20], [40,50], [70,80]; valleys at 30 and 60. */
const bands: Bands = { cores: [[10, 20], [40, 50], [70, 80]], valleys: [30, 60] }
const W = 60
const H = 100

function make(draw: (set: (x: number, y: number) => void) => void) {
  const ink = new Uint8Array(W * H)
  draw((x, y) => {
    ink[y * W + x] = 1
  })
  const labels = labelComponents(ink, W, H)
  return { ink, labels, own: ownership(labels, bands) }
}
const vline = (set: (x: number, y: number) => void, x: number, y0: number, y1: number) => {
  for (let y = y0; y <= y1; y++) set(x, y)
}
const ownerAt = (o: ReturnType<typeof make>, x: number, y: number) => o.own.owner[y * W + x]

describe('ownership', () => {
  it('keeps a component in one band whole, even across a valley row (ascenders and descenders)', () => {
    const o = make((s) => vline(s, 5, 5, 35)) // rows 5..35 touches only band 0 (10..20)
    expect(new Set([5, 20, 30, 35].map((y) => ownerAt(o, 5, y)))).toEqual(new Set([0]))
    expect(o.own.splits).toEqual([])
  })
  it('splits a component in two bands at the valley row: y < v up, y >= v down', () => {
    const o = make((s) => vline(s, 8, 15, 45))
    expect(ownerAt(o, 8, 29)).toBe(0)
    expect(ownerAt(o, 8, 30)).toBe(1)
    expect(o.own.splits.length).toBe(1)
    expect(o.own.splits[0]).toMatchObject({ valleyRows: [30], lines: [0, 1], totalPixels: 31, rows: [15, 45] })
    expect(o.own.splits[0]!.pixelsPerLine).toEqual([15, 16])
    expect([...o.own.components.values()][0]!.split).toBe(true)
  })
  it('splits three bands at both valleys', () => {
    const o = make((s) => vline(s, 8, 12, 78))
    expect(ownerAt(o, 8, 29)).toBe(0)
    expect(ownerAt(o, 8, 30)).toBe(1)
    expect(ownerAt(o, 8, 59)).toBe(1)
    expect(ownerAt(o, 8, 60)).toBe(2)
    expect(o.own.splits[0]!.valleyRows).toEqual([30, 60])
  })
  it('gives a no-band component to the nearest band by centroid, ties to the upper line', () => {
    const p = make((s) => {
      for (let y = 22; y <= 33; y++) for (let x = 20; x < 26; x++) s(x, y) // 72 px, centroid 27.5: band0 gap 7.5, band1 gap 12.5
    })
    expect(ownerAt(p, 20, 22)).toBe(0)
    expect(ownerAt(p, 20, 33)).toBe(0)
    const t = make((s) => {
      for (let y = 25; y <= 34; y++) for (let x = 20; x < 24; x++) s(x, y) // 40 px, centroid 29.5: 9.5 from band0 (ends 20) vs 10.5 from band1 (40)
    })
    expect(ownerAt(t, 20, 25)).toBe(0)
    const tie = make((s) => {
      for (let y = 30; y <= 30; y++) for (let x = 0; x < 40; x++) s(x, y) // 40 px at row 30: 10 from band0, 10 from band1 -> upper
    })
    expect(ownerAt(tie, 0, 30)).toBe(0)
  })
  it('gives small components (under 30 px) to the nearest band by centroid, whatever they touch', () => {
    const o = make((s) => vline(s, 30, 18, 25)) // 8 px, centroid 21.5 (touches band 0)
    expect(ownerAt(o, 30, 25)).toBe(0)
    const q = make((s) => vline(s, 30, 36, 44)) // 9 px; centroid 40 -> band 1 even though it starts above
    expect(new Set([36, 44].map((y) => ownerAt(q, 30, y)))).toEqual(new Set([1]))
    expect(q.own.splits).toEqual([])
  })
  it('every ink pixel has one owner and every other pixel none', () => {
    const o = make((s) => {
      vline(s, 4, 0, 99)
      vline(s, 9, 15, 45)
      for (let x = 20; x < 29; x++) s(x, 90)
    })
    for (let i = 0; i < W * H; i++) expect(o.own.owner[i]! >= 0).toBe(o.ink[i] === 1)
  })
  it('nearestBand is zero inside a band and prefers the upper line on a tie', () => {
    expect(nearestBand(15, bands.cores)).toBe(0)
    expect(nearestBand(30, bands.cores)).toBe(0)
    expect(nearestBand(31, bands.cores)).toBe(1)
  })
  it('is deterministic', () => {
    const a = make((s) => vline(s, 8, 15, 45))
    const b = make((s) => vline(s, 8, 15, 45))
    expect(a.own.owner).toEqual(b.own.owner)
  })
})
