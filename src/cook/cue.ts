// The haunting cue (R16): one dip of the lamp and one duck of the simmer at the moment a note is revealed, and the brown noise the simmer is made of.
// The numbers are starting values chosen by eye and ear; the tests pin the shape (bounds, endpoints, one minimum), not the numbers.

export const LAMP_DIP_MS = 900
/** Brightness factor at the bottom of the dip (1 is normal). */
export const LAMP_MIN = 0.35
/** Level of the simmer. */
export const SIMMER_GAIN = 0.12
/** Fraction of SIMMER_GAIN at the bottom of the duck. */
export const SIMMER_DUCK = 0.05
export const CUE_COOLDOWN_MS = 3000
export const SIMMER_END_MS = 2100

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * `lamp` falls from 1 to LAMP_MIN over the first 200 ms, holds 100 ms, rises back to 1 over the last 600 ms (smoothstep each way).
 * `simmer` falls to SIMMER_DUCK over 300 ms, holds until 600 ms, and rises back to 1 by 2100 ms. Both are exactly 1 at and outside their ends.
 */
export function cueEnvelope(tMs: number): { lamp: number; simmer: number } {
  const t = Number.isFinite(tMs) ? tMs : 0
  let lamp = 1
  if (t > 0 && t < LAMP_DIP_MS) lamp = t < 200 ? lerp(1, LAMP_MIN, smooth(t / 200)) : t < 300 ? LAMP_MIN : lerp(LAMP_MIN, 1, smooth((t - 300) / 600))
  let simmer = 1
  if (t > 0 && t < SIMMER_END_MS) simmer = t < 300 ? lerp(1, SIMMER_DUCK, smooth(t / 300)) : t < 600 ? SIMMER_DUCK : lerp(SIMMER_DUCK, 1, smooth((t - 600) / (SIMMER_END_MS - 600)))
  return { lamp, simmer }
}

/** The gain the simmer is set to at time t of a cue: never above SIMMER_GAIN. */
export const simmerGainAt = (tMs: number): number => SIMMER_GAIN * cueEnvelope(tMs).simmer

/** A small seeded generator (mulberry32). No Math.random, so the noise is the same everywhere. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const NOISE_FADE = 2048

/**
 * Brown noise for a seamless loop: y[i] = (y[i-1] + 0.02 w[i]) / 1.02 with seeded white w, the first 2048 samples crossfaded
 * (equal power) with the 2048 that follow the loop's end, scaled to a peak of 0.9. Deterministic.
 */
export function brownNoise(n: number, seed: number): Float32Array {
  const L = Math.min(NOISE_FADE, Math.floor(n / 2))
  const rnd = prng(seed)
  const y = new Float64Array(n + L)
  let prev = 0
  for (let i = 0; i < y.length; i++) y[i] = prev = (prev + 0.02 * (rnd() * 2 - 1)) / 1.02
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = y[i]!
  for (let i = 0; i < L; i++) {
    const th = (Math.PI / 2) * (i / L)
    out[i] = y[i]! * Math.sin(th) + y[n + i]! * Math.cos(th)
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const k = peak > 0 ? 0.9 / peak : 0
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = out[i]! * k
  return f
}
