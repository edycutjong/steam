// Page slant (R22.4). Convention: x' = x - s * (yMid - y). A stroke that leans right (its upper end is further right)
// has s > 0 and becomes vertical in x'. The spike used the opposite sign; the tests, not the spike, decide.

import { SLANT_RANGE, SLANT_STEP, SLANT_ZERO_BELOW } from './constants.ts'

export const shear = (x: number, y: number, yMid: number, s: number): number => x - s * (yMid - y)
export const unshear = (xp: number, y: number, yMid: number, s: number): number => xp + s * (yMid - y)

export interface SlantEstimate {
  /** The shear in [-0.5, 0.8] (step 0.05) that maximises the sum of squared column counts; 0 when under 0.05 in size. */
  s: number
  /** True when |s| < 0.05 was rounded to 0 and reported as vertical (R18.2). */
  vertical: boolean
}

/**
 * `midOfRow[y]` is the vertical middle of the line that row y belongs to. Ties go to the smaller |s|.
 */
export function estimateSlant(ink: Uint8Array, width: number, height: number, midOfRow: ArrayLike<number>): SlantEstimate {
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink[y * width + x]) (xs.push(x), ys.push(y))
  const [lo, hi] = SLANT_RANGE
  const off = Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)) * height) + 2
  const hist = new Int32Array(width + 2 * off + 2)
  let best = 0
  let bestScore = -1
  const n = Math.round((hi - lo) / SLANT_STEP)
  const cand: number[] = []
  for (let k = 0; k <= n; k++) cand.push(Math.round((lo + k * SLANT_STEP) * 1e6) / 1e6)
  cand.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
  for (const s of cand) {
    hist.fill(0)
    for (let i = 0; i < xs.length; i++) hist[Math.round(shear(xs[i]!, ys[i]!, midOfRow[ys[i]!]!, s)) + off]!++
    let score = 0
    for (let b = 0; b < hist.length; b++) score += hist[b]! * hist[b]!
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  if (Math.abs(best) < SLANT_ZERO_BELOW - 1e-9) return { s: 0, vertical: true }
  return { s: best, vertical: false }
}
