import { existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { HEAD_BINS, HULL_DILATE_PX, HULL_FEATHER_PX, derive, type PixelSource } from './derive.ts'

interface Synth {
  toi: PixelSource
  note: PixelSource
}

/** One horizontal stroke; toi G rises with x, so the head runs left to right. */
function synth(w: number, h: number, x0: number, x1: number, y0: number, y1: number): Synth {
  const toi = new Uint8ClampedArray(w * h * 4)
  const note = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      toi[o + 3] = 255
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        toi[o] = 255
        toi[o + 1] = Math.round(((x - x0) / (x1 - x0 - 1)) * 255)
        toi[o + 2] = 128
        note[o + 3] = 255
      }
    }
  }
  return { toi: { data: toi, width: w, height: h }, note: { data: note, width: w, height: h } }
}

describe('derive on a synthetic 40x20 note', () => {
  const { toi, note } = synth(40, 20, 8, 32, 8, 12)
  const d = derive(toi, note)
  const at = (x: number, y: number) => (y * 40 + x) * 4

  it('has the exact output sizes', () => {
    expect(d.chan.length).toBe(40 * 20 * 4)
    expect(d.head.length).toBe(HEAD_BINS * 2)
    expect(d.headBins).toBe(HEAD_BINS)
  })
  it('has channel alpha 255 at every ink pixel', () => {
    for (let y = 8; y < 12; y++) for (let x = 8; x < 32; x++) expect(d.chan[at(x, y)]).toBe(255)
  })
  it('gives dilated pixels the toi of the nearest ink', () => {
    expect(d.chan[at(7, 10) + 1]).toBe(d.chan[at(8, 10) + 1])
    expect(d.chan[at(20, 12) + 1]).toBe(d.chan[at(20, 11) + 1])
    expect(d.chan[at(20, 12)]).toBeGreaterThan(0)
    expect(d.chan[at(20, 14)]).toBe(0) // growth stays within one texel (D6)
  })
  it('leaves far pixels untouched', () => {
    expect(d.chan[at(2, 2)]).toBe(0)
    expect(d.chan[at(2, 2) + 1]).toBe(0)
  })
  it('has a head x that never decreases along the line', () => {
    let prev = -Infinity
    for (let b = 0; b < HEAD_BINS; b++) {
      expect(d.head[b * 2]).toBeGreaterThanOrEqual(prev - 1e-4)
      prev = d.head[b * 2]
    }
    expect(d.head[0]).toBeLessThan(d.head[(HEAD_BINS - 1) * 2])
  })
  it('contains no NaN', () => {
    expect(Array.from(d.head).every(Number.isFinite)).toBe(true)
  })
})

describe('feather', () => {
  const w = 100
  const { toi, note } = synth(w, 12, 2, 6, 4, 8)
  const d = derive(toi, note)
  const a = (x: number) => d.chan[(6 * w + x) * 4 + 3]

  it('is 255 on ink and within the dilated hull', () => {
    for (let x = 2; x < 6; x++) expect(a(x)).toBe(255)
    expect(a(6 + HULL_DILATE_PX - 1)).toBe(255)
  })
  it('is 0 at 30 px away and beyond', () => {
    for (let x = 5 + HULL_DILATE_PX + HULL_FEATHER_PX; x < w; x++) expect(a(x)).toBe(0)
  })
  it('does not increase with distance', () => {
    for (let x = 6; x < w; x++) expect(a(x)).toBeLessThanOrEqual(a(x - 1))
  })
})

describe('derive on the real hero files', () => {
  const base = new URL('../../public/hero/', import.meta.url)
  const toiUrl = new URL('note-looks-red-smooth.toi.png', base)
  const noteUrl = new URL('note-looks-red-smooth.png', base)
  const have = existsSync(toiUrl) && existsSync(noteUrl)

  it.skipIf(!have)('keeps the hull reach off the outer 1 px ring', () => {
    const decode = (u: URL): PixelSource => {
      const p = PNG.sync.read(readFileSync(u))
      return { data: p.data, width: p.width, height: p.height }
    }
    const toi = decode(toiUrl)
    const note = decode(noteUrl)
    const d = derive(toi, note)
    const { width: w, height: h } = toi
    let reach = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const A = d.chan[(y * w + x) * 4 + 3]
        if (A > 0) reach++
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) expect(A).toBe(0)
      }
    }
    expect(reach).toBeGreaterThan(0)
    expect(Array.from(d.head).every(Number.isFinite)).toBe(true)
  })
})

describe('derive: no unwritten stroke shows (D1)', () => {
  it('gives every pixel with channel alpha > 0 the toi of its stroke, so the rim cannot appear early', () => {
    const w = 60
    const h = 20
    const toi = new Uint8ClampedArray(w * h * 4)
    const note = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        toi[o + 3] = 255
        if (x >= 20 && x < 40 && y >= 8 && y < 12) {
          toi[o] = 255
          toi[o + 1] = 200
          toi[o + 2] = 128
        }
      }
    }
    const d = derive({ data: toi, width: w, height: h }, { data: note, width: w, height: h })
    let halo = 0
    for (let p = 0; p < w * h; p++) {
      if (d.chan[p * 4] > 0) {
        expect(d.chan[p * 4 + 1]).toBe(200)
        if (toi[p * 4] === 0) halo++
      }
    }
    expect(halo).toBeGreaterThan(0)
  })
})
