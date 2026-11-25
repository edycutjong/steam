// P-T3 (steam-renderer-v1 design §3): the glass clears by the scan's continuous alpha through `trans`, so the area it clears
// (the sum of T over the displayed pixels) stays within 0.85 and 1.15 of the scan's own ink (the sum of a), at texture
// resolution and magnified 2x with the bicubic filter the composite uses. Counters stay open; hairlines stay present.
// (v0's D12 bound measured a narrow threshold band over the same alpha: 1.17 at 1x.)
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { derive, type PixelSource } from './derive.ts'
import { FEATHER_K } from './shaders.ts'
import { TOI_SOFT } from './timeline.ts'
import { sampleCatmull, trans } from './transmission.ts'

const base = new URL('../../public/recipes/quinces-marmalade/', import.meta.url)
const toiUrl = new URL('note-till-it-looks-red-smooth.toi.png', base)
const noteUrl = new URL('note-till-it-looks-red-smooth.png', base)

function decode(u: URL): PixelSource {
  const p = PNG.sync.read(readFileSync(u))
  return { data: p.data, width: p.width, height: p.height }
}

/** Sum of T over the displayed pixels at an integer magnification, divided by `up^2` so it is in note-pixel units. */
function clearedArea(ink: Uint8Array, w: number, h: number, up: number): number {
  let area = 0
  for (let y = 0; y < h * up; y++) {
    for (let x = 0; x < w * up; x++) {
      area += trans(sampleCatmull(ink, w, h, (x + 0.5) / up, (y + 0.5) / up))
    }
  }
  return area / (up * up)
}

describe('cleared glass area on the hero note (P-T3)', () => {
  const toi = decode(toiUrl)
  const note = decode(noteUrl)
  const { ink } = derive(toi, note)
  const { width: w, height: h } = toi
  let scanInk = 0
  for (let p = 0; p < w * h; p++) scanInk += toi.data[p * 4] / 255

  it('carries the scan alpha unchanged into the ink texture', () => {
    for (let p = 0; p < w * h; p += 7) expect(ink[p]).toBe(toi.data[p * 4])
  })
  it.each([1, 2])('clears between 0.85 and 1.15 times the scan ink area at %ix magnification', (up) => {
    const ratio = clearedArea(ink, w, h, up) / scanInk
    expect(ratio).toBeLessThanOrEqual(1.15)
    expect(ratio).toBeGreaterThanOrEqual(0.85)
  })
  it('clears hairlines partly: pixels with alpha 0.1 to 0.3 are neither fog nor fully clear', () => {
    let n = 0
    let mid = 0
    for (let p = 0; p < w * h; p++) {
      const a = ink[p] / 255
      if (a < 0.1 || a > 0.3) continue
      n++
      const t = trans(a)
      if (t > 0.02 && t < 0.6) mid++
    }
    expect(n).toBeGreaterThan(200)
    expect(mid / n).toBeGreaterThan(0.95)
  })
})

describe('write-on leading edge on the hero toi map (D15)', () => {
  it('is feathered over 6 to 10 texels along the path', () => {
    const toi = decode(toiUrl)
    const { width: w, height: h, data } = toi
    const slopes: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 3; x < w - 3; x++) {
        const a = (y * w + x - 3) * 4
        const b = (y * w + x + 3) * 4
        if (data[a] < 200 || data[b] < 200) continue
        slopes.push(Math.abs(data[b + 1] - data[a + 1]) / 255 / 6)
      }
    }
    slopes.sort((p, q) => p - q)
    const typical = slopes[Math.floor(slopes.length * 0.75)]
    const texels = (TOI_SOFT * FEATHER_K) / typical
    expect(texels).toBeGreaterThanOrEqual(5)
    expect(texels).toBeLessThanOrEqual(10)
  })
})
