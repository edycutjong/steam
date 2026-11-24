// D12: the revealed channel must not be wider than the scan's own ink at the displayed scale.
import { existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { derive, type PixelSource } from './derive.ts'
import { CLEAR_HALF, CLEAR_HALF_THICK, CLEAR_HALF_THIN, clearCurve } from './shaders.ts'

const base = new URL('../../public/hero/', import.meta.url)
const toiUrl = new URL('note-looks-red-smooth.toi.png', base)
const noteUrl = new URL('note-looks-red-smooth.png', base)

function decode(u: URL): PixelSource {
  const p = PNG.sync.read(readFileSync(u))
  return { data: p.data, width: p.width, height: p.height }
}

/** Revealed area at an integer upsampling factor, bilinear like the GPU's LINEAR filter. */
function revealedArea(chan: Uint8Array, w: number, h: number, up: number, half: number): number {
  const R = (x: number, y: number): number =>
    chan[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255
  let area = 0
  for (let y = 0; y < h * up; y++) {
    for (let x = 0; x < w * up; x++) {
      const fx = (x + 0.5) / up - 0.5
      const fy = (y + 0.5) / up - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const v =
        (R(x0, y0) * (1 - tx) + R(x0 + 1, y0) * tx) * (1 - ty) +
        (R(x0, y0 + 1) * (1 - tx) + R(x0 + 1, y0 + 1) * tx) * ty
      area += clearCurve(v, half)
    }
  }
  return area / (up * up)
}

describe.skipIf(!existsSync(toiUrl) || !existsSync(noteUrl))('revealed stroke coverage on the hero toi map (D12)', () => {
  const toi = decode(toiUrl)
  const note = decode(noteUrl)
  const { chan } = derive(toi, note)
  const { width: w, height: h } = toi
  let scanInk = 0
  for (let p = 0; p < w * h; p++) scanInk += toi.data[p * 4] / 255

  it('reveals at most 1.15 times the scan ink area, at texture resolution', () => {
    expect(revealedArea(chan, w, h, 1, CLEAR_HALF) / scanInk).toBeLessThanOrEqual(1.15)
  })
  it('reveals at most 1.15 times the scan ink area at 2x bilinear (the desktop display scale)', () => {
    expect(revealedArea(chan, w, h, 2, CLEAR_HALF) / scanInk).toBeLessThanOrEqual(1.15)
  })
  it('keeps the bound in thin and in thick fog, where the edge band is wider and narrower (D13)', () => {
    for (const half of [CLEAR_HALF_THIN, CLEAR_HALF_THICK]) {
      const ratio = revealedArea(chan, w, h, 2, half) / scanInk
      expect(ratio).toBeLessThanOrEqual(1.15)
      expect(ratio).toBeGreaterThanOrEqual(0.85)
    }
  })
  it('does not lose the pen: at least 0.85 of the scan ink area stays revealed (hairlines, counters)', () => {
    expect(revealedArea(chan, w, h, 2, CLEAR_HALF) / scanInk).toBeGreaterThanOrEqual(0.85)
  })
})
