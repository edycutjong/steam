// The haunting cue's shader side (steam-renderer-v1 design §7.4): a cold bloom of fog from the pane edges and the dip of the
// candle's light. Pure functions of the reveal clock (ms after reveal start; negative while thickening).
import { THICKEN_MS, WRITE_ON_MS } from './timeline.ts'
import type { Phase } from './timeline.ts'

/** The DOM side of the cue: calm before the reveal, gather while the hand is written, clear once it holds. */
export type Haunt = 'calm' | 'gather' | 'clear'

export function hauntOfPhase(phase: Phase): Haunt {
  return phase === 'fogged' ? 'calm' : phase === 'thickening' || phase === 'writing' ? 'gather' : 'clear'
}

/** The bloom relaxes from 1 to BLOOM_HOLD over this long after the write-on starts, and fades to 0 over BLOOM_FADE_MS after it ends. */
export const BLOOM_RELAX_MS = 2000
export const BLOOM_HOLD = 0.45
export const BLOOM_FADE_MS = 1500
/** The candle's light falls to (1 - CANDLE_DIP) of itself during the cue. */
export const CANDLE_DIP = 0.55
export const CANDLE_GUTTER_MS = 600

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number): number => {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}

/** 0 before the thickening, rises to 1 at t = 0 (the cold bloom creeps in), relaxes while the hand is written, 0 again by WRITE_ON_MS + BLOOM_FADE_MS. */
export function bloomAt(tMs: number): number {
  if (!Number.isFinite(tMs) || tMs <= -THICKEN_MS) return 0
  if (tMs < 0) return smooth((tMs + THICKEN_MS) / THICKEN_MS)
  if (tMs < WRITE_ON_MS) return 1 - (1 - BLOOM_HOLD) * smooth(tMs / BLOOM_RELAX_MS)
  return BLOOM_HOLD * (1 - smooth((tMs - WRITE_ON_MS) / BLOOM_FADE_MS))
}

/** 0..1: how far the candle is guttering. Rises over the first CANDLE_GUTTER_MS of the thickening, holds, recovers after the write-on. */
export function candleDipAt(tMs: number): number {
  if (!Number.isFinite(tMs) || tMs <= -THICKEN_MS) return 0
  if (tMs < WRITE_ON_MS) return smooth((tMs + THICKEN_MS) / CANDLE_GUTTER_MS)
  return 1 - smooth((tMs - WRITE_ON_MS) / BLOOM_FADE_MS)
}

/** Candle light level: flicker around 0.9, and the dip of the cue. `timeSec` is the render clock. */
export function candleLevel(timeSec: number, tMs: number): number {
  const flick = 0.9 + 0.1 * Math.sin(timeSec * 7.3) * Math.sin(timeSec * 4.1 + 0.6)
  return flick * (1 - CANDLE_DIP * candleDipAt(tMs))
}

// ---- Look pass 3: something unseen is writing (design section 15) -----------------------------------------------------

/** The finger leads the ink by this long (ms of the write-on): it is the unseen fingertip, the ink follows it. */
export const FINGER_LEAD_MS = 300
/** Length of the wet streak behind the fingertip, in toi units (about 60 ms). */
export const FINGER_TAIL_U = 0.012

/** The reveal clock in toi units the finger is at, for a clock `u` (0..1) that the ink has reached. */
export function fingerU(u: number): number {
  if (!(u >= 0)) return 0
  return Math.min(1, u + FINGER_LEAD_MS / WRITE_ON_MS)
}

/** A breath pulse over the first 1.5 s of the write-on: rises over 300 ms, falls over 1.2 s. In [0, 1]. */
export const BREATH_MS = 1500
export function breathAt(tMs: number): number {
  if (!Number.isFinite(tMs) || tMs <= 0 || tMs >= BREATH_MS) return 0
  return smooth(tMs / 300) * (1 - smooth((tMs - 300) / (BREATH_MS - 300)))
}

/** The cold breath around the point where the hand will begin: grows over the thickening, peaks at t = 0, gone by 800 ms. In [0, 1]. */
export function coldBreathAt(tMs: number): number {
  if (!Number.isFinite(tMs) || tMs <= -THICKEN_MS) return 0
  if (tMs < 0) return smooth((tMs + THICKEN_MS) / THICKEN_MS)
  return 1 - smooth(tMs / 800)
}

/**
 * How far the candle's flame leans toward the writing head, in [-1, 1]: the sign of `headX - candleX`, growing with the distance
 * (full at half a pane). 0 unless the cue is on (`cueOn`: thickening or writing).
 */
export function candleLean(headX: number, candleX: number, paneW: number, cueOn: boolean): number {
  if (!cueOn || !(paneW > 0) || !Number.isFinite(headX) || !Number.isFinite(candleX)) return 0
  const k = (headX - candleX) / (0.5 * paneW)
  return k < -1 ? -1 : k > 1 ? 1 : k
}

/** Cloud shift in night view units: non-decreasing, over the moon's centre (250) about 3.3 s into the write-on, clear of the moon after the hold. */
export const CLOUD_OVER_MOON = 250
export const CLOUD_TRAVEL = 520
const CLOUD_START_MS = -THICKEN_MS
const CLOUD_END_MS = WRITE_ON_MS + 3000
export function cloudShiftAt(tMs: number): number {
  if (!Number.isFinite(tMs)) return tMs > 0 ? CLOUD_TRAVEL : 0
  return CLOUD_TRAVEL * smooth((tMs - CLOUD_START_MS) / (CLOUD_END_MS - CLOUD_START_MS))
}

/** How much of the moon the cloud dims, in [0, 0.5]: most when the cloud is over its centre. */
export function moonDimAt(tMs: number): number {
  const d = Math.abs(cloudShiftAt(tMs) - CLOUD_OVER_MOON) / 220
  return d >= 1 ? 0 : 0.5 * (1 - d) * (1 - d) * (3 - 2 * (1 - d))
}
