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
