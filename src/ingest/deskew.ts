// Page tilt: estimate, and rotate only when it is large enough to matter (R7).

import { DESKEW_APPLY_MIN, DESKEW_RANGE_DEG, DESKEW_STEP } from './constants.ts'
import { rotate, type Gray } from './image.ts'

/**
 * Degrees of tilt (positive: the text lines descend to the right) that maximise the variance of the row projection
 * of the ink after undoing it (R7.1). Ties go to the smaller angle.
 */
export function estimateTilt(ink: Uint8Array, width: number, height: number, range = DESKEW_RANGE_DEG, step = DESKEW_STEP): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink[y * width + x]) (xs.push(x), ys.push(y))
  if (xs.length === 0) return 0
  const steps = Math.round(range / step)
  const bins = height + width * 2 + 4
  const hist = new Int32Array(bins)
  let best = 0
  let bestScore = -1
  const order: number[] = [0]
  for (let k = 1; k <= steps; k++) order.push(k, -k)
  for (const k of order) {
    const deg = Math.round(k * step * 1e6) / 1e6
    const tan = Math.tan((deg * Math.PI) / 180)
    const off = Math.ceil(width * Math.abs(tan)) + 2
    hist.fill(0)
    for (let i = 0; i < xs.length; i++) hist[Math.round(ys[i]! - xs[i]! * tan) + off]!++
    let score = 0
    for (let b = 0; b < bins; b++) score += hist[b]! * hist[b]!
    if (score > bestScore * (1 + 1e-9)) {
      bestScore = score
      best = deg
    }
  }
  return best
}

export interface Deskewed {
  gray: Gray
  /** The measured angle, always reported. */
  deg: number
  applied: boolean
}

/** R7.2/R7.3: below 0.5 degrees the frame is kept; otherwise the page is rotated about its centre (bilinear). */
export function applyDeskew(g: Gray, deg: number): Deskewed {
  if (Math.abs(deg) < DESKEW_APPLY_MIN) return { gray: g, deg, applied: false }
  const hist = new Uint32Array(256)
  for (const v of g.data) hist[v]!++
  let acc = 0
  let med = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!
    if (acc * 2 >= g.data.length) {
      med = v
      break
    }
  }
  return { gray: rotate(g, -deg, med), deg, applied: true }
}
