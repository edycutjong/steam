// Row projection, line finding, separators, blocks, region and marginalia (R5, R8).

import { CORE_FRACTION, PEAK_MIN_DISTANCE, PEAK_MIN_FRACTION, PROFILE_SIGMA } from './constants.ts'

/** Ink pixels per row, over columns [x0, x1) (default: all). */
export function rowProfile(ink: Uint8Array, width: number, height: number, x0 = 0, x1 = width): Float64Array {
  const out = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = x0; x < x1; x++) n += ink[y * width + x]!
    out[y] = n
  }
  return out
}

/** Gaussian smoothing of a 1-D profile; the kernel is truncated at 3 sigma and renormalised at the borders. */
export function gaussian1d(p: Float64Array, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = new Float64Array(2 * r + 1)
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  const out = new Float64Array(p.length)
  for (let y = 0; y < p.length; y++) {
    let s = 0
    let ws = 0
    for (let i = -r; i <= r; i++) {
      const yy = y + i
      if (yy < 0 || yy >= p.length) continue
      s += p[yy]! * k[i + r]!
      ws += k[i + r]!
    }
    out[y] = s / ws
  }
  return out
}

export interface FoundLine {
  peakRow: number
  /** Inclusive rows [top, bottom] at or above 60% of the smoothed peak. */
  core: [number, number]
}
export interface FoundLines {
  lines: FoundLine[]
  /** valleys[i] lies between lines[i] and lines[i+1]. */
  valleys: number[]
  /** Median distance between neighbouring peaks, 0 with fewer than two lines. */
  pitch: number
  /** The smoothed profile the decisions were made on. */
  profile: Float64Array
}

/**
 * R8: Gaussian sigma 6 (scaled), local maxima above 25% of the global maximum, the higher of two maxima closer
 * than 40 rows (scaled), cores at 60% of the peak, valley = argmin between neighbours (lowest row on a tie).
 */
export function findLines(raw: Float64Array, scale = 1, sigma = PROFILE_SIGMA * scale): FoundLines {
  const prof = gaussian1d(raw, Math.max(sigma, 0.5))
  let max = 0
  for (const v of prof) max = Math.max(max, v)
  const minDist = PEAK_MIN_DISTANCE * scale
  const peaks: number[] = []
  if (max > 0) {
    for (let y = 1; y < prof.length - 1; y++) {
      if (prof[y]! >= prof[y - 1]! && prof[y]! > prof[y + 1]! && prof[y]! > PEAK_MIN_FRACTION * max) {
        const last = peaks[peaks.length - 1]
        if (last !== undefined && y - last < minDist) {
          if (prof[y]! > prof[last]!) peaks[peaks.length - 1] = y
        } else peaks.push(y)
      }
    }
  }
  const valleys: number[] = []
  for (let i = 0; i + 1 < peaks.length; i++) {
    const a = peaks[i]!
    const b = peaks[i + 1]!
    let best = a + 1
    for (let y = a + 1; y < b; y++) if (prof[y]! < prof[best]!) best = y
    valleys.push(best)
  }
  const lines: FoundLine[] = peaks.map((p, i) => {
    const thr = CORE_FRACTION * prof[p]!
    const lo = i > 0 ? valleys[i - 1]! + 1 : 0
    const hi = i < valleys.length ? valleys[i]! - 1 : prof.length - 1
    let a = p
    let b = p
    while (a - 1 >= lo && prof[a - 1]! >= thr) a--
    while (b + 1 <= hi && prof[b + 1]! >= thr) b++
    return { peakRow: p, core: [a, b] }
  })
  const d = peaks.slice(1).map((p, i) => p - peaks[i]!).sort((a, b) => a - b)
  const pitch = d.length === 0 ? 0 : d.length % 2 ? d[(d.length - 1) / 2]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2
  return { lines, valleys, pitch, profile: prof }
}
