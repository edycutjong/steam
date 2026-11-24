// Pure reveal timeline: clock (ms after reveal start) -> RevealState. No DOM, no GL.

export const LEAD_MS = 2500
export const THICKEN_MS = 1200
export const WRITE_ON_MS = 5000
export const WIPE_MS = 1400
export const REFOG_MS = 20000
export const HEAD_FADE_MS = 250
export const TOI_SOFT = 0.012

export type Phase = 'fogged' | 'thickening' | 'writing' | 'holding' | 'wiped'

export const PHASE_ORDER: readonly Phase[] = ['fogged', 'thickening', 'writing', 'holding', 'wiped']

export interface RevealState {
  phase: Phase
  /** Reveal clock in toi units. -1 before writing, 0..1 while writing, 1 after. */
  u: number
  /** 0..1 extra condensation before the reveal. 1 from t >= 0. */
  thicken: number
  /** 0..1 writing-head intensity. */
  head: number
  /** 0..1 sweep progress, 0 until the wipe. */
  wipe: number
  /** 0..1 fog return outside the hull, 0 until the wipe sweep ends. */
  refog: number
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smoothstep = (x: number): number => {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}
const easeOut = (x: number): number => {
  const inv = 1 - clamp01(x)
  return 1 - inv * inv * inv
}

export function revealState(tMs: number, wipeAtMs: number | null): RevealState {
  const t = Number.isFinite(tMs) ? tMs : -Infinity
  if (t < -THICKEN_MS) {
    return { phase: 'fogged', u: -1, thicken: 0, head: 0, wipe: 0, refog: 0 }
  }
  if (t < 0) {
    return {
      phase: 'thickening',
      u: -1,
      thicken: smoothstep((t + THICKEN_MS) / THICKEN_MS),
      head: 0,
      wipe: 0,
      refog: 0,
    }
  }
  if (t < WRITE_ON_MS) {
    const head = Math.min(clamp01(t / HEAD_FADE_MS), clamp01((WRITE_ON_MS - t) / HEAD_FADE_MS))
    return { phase: 'writing', u: t / WRITE_ON_MS, thicken: 1, head, wipe: 0, refog: 0 }
  }
  const wipeAt =
    wipeAtMs === null || !Number.isFinite(wipeAtMs) ? null : Math.max(wipeAtMs, WRITE_ON_MS)
  if (wipeAt === null || t < wipeAt) {
    return { phase: 'holding', u: 1, thicken: 1, head: 0, wipe: 0, refog: 0 }
  }
  return {
    phase: 'wiped',
    u: 1,
    thicken: 1,
    head: 0,
    wipe: clamp01((t - wipeAt) / WIPE_MS),
    refog: easeOut((t - wipeAt - WIPE_MS) / REFOG_MS),
  }
}
