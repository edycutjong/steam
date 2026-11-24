// Sauvola binarisation from integral images (R6).

import { INK_MEDIAN_GUARD, SAUVOLA_K, SAUVOLA_R, SAUVOLA_WINDOW } from './constants.ts'
import type { Gray } from './image.ts'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Sauvola threshold map; the window is clipped to the image at the borders (R6.1). `window` should be odd. */
export function sauvola(g: Gray, window = SAUVOLA_WINDOW, k = SAUVOLA_K, R = SAUVOLA_R): Float32Array {
  const { width: w, height: h, data } = g
  const W = w + 1
  const sum = new Float64Array(W * (h + 1))
  const sq = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let rs = 0
    let rq = 0
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x]!
      rs += v
      rq += v * v
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1]! + rs
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1]! + rq
    }
  }
  const r = window >> 1
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r)
    const yb = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r)
      const xb = Math.min(w, x + r + 1)
      const n = (xb - xa) * (yb - ya)
      const s = sum[yb * W + xb]! - sum[ya * W + xb]! - sum[yb * W + xa]! + sum[ya * W + xa]!
      const q = sq[yb * W + xb]! - sq[ya * W + xb]! - sq[yb * W + xa]! + sq[ya * W + xa]!
      const m = s / n
      const sd = Math.sqrt(Math.max(0, q / n - m * m))
      out[y * w + x] = m * (1 + k * (sd / R - 1))
    }
  }
  return out
}

/** The raw map `gray < T_sauvola` (R6.3): the recall definition of the hero fixture is stated on it. */
export function rawInk(g: Gray, window = SAUVOLA_WINDOW): Uint8Array {
  const t = sauvola(g, window)
  const out = new Uint8Array(g.data.length)
  for (let i = 0; i < out.length; i++) out[i] = g.data[i]! < t[i]! ? 1 : 0
  return out
}

function medianOf(g: Gray, region?: Rect): number {
  const hist = new Uint32Array(256)
  const r = region ?? { x0: 0, y0: 0, x1: g.width, y1: g.height }
  let n = 0
  for (let y = Math.max(0, r.y0); y < Math.min(g.height, r.y1); y++)
    for (let x = Math.max(0, r.x0); x < Math.min(g.width, r.x1); x++) {
      hist[g.data[y * g.width + x]!]!++
      n++
    }
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!
    if (acc * 2 >= n) return v
  }
  return 255
}

/** Ink = `gray < T_sauvola` and `gray < median(region gray) - 25` (R6.2). */
export function inkMap(g: Gray, opts: { window?: number; region?: Rect } = {}): Uint8Array {
  const raw = rawInk(g, opts.window)
  const cut = medianOf(g, opts.region) - INK_MEDIAN_GUARD
  for (let i = 0; i < raw.length; i++) raw[i] = raw[i]! && g.data[i]! < cut ? 1 : 0
  return raw
}
