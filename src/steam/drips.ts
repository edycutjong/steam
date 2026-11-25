// Running water under the hand (steam-renderer-v1 design §6.2). Pure and seeded: no Math.random, no clock reads.
// `planDrips` works in note pixels once per note; `placeDrips` maps the plan to css pixels for a layout;
// `dripDistance` is a pure function of (run, t), so a frozen `?t=` frame is reproducible.

import type { Layout } from './layout.ts'
import { WRITE_ON_MS } from './timeline.ts'

export interface PlanGroup {
  rect: [number, number, number, number]
}

/** A run chosen on the scan: where it starts (note px), how heavy the stroke is, when that stroke is written. */
export interface PlannedRun {
  /** Index into the meta groups the point lies in. */
  group: number
  x: number
  y: number
  /** Ink mass of the vertical dark run above the point (sum of alpha, 0..1 per pixel). */
  mass: number
  /** Time-of-ink at the point, 0..1: the stroke is written at `u0 * WRITE_ON_MS`. */
  u0: number
  /** Seeded delay after the stroke is written, ms. */
  delayMs: number
  /** Seeded 0..1 values for length, duration, pause and wobble. */
  r: [number, number, number, number]
}

export const MAX_RUNS = 6
/** Candidates the plan keeps; `placeDrips` shows only some of them. */
export const MIN_RUNS = 3
/** Runs shown on a pane wider than PHONE_RUN_W css px: 2 to 4; on a narrower pane: 1 to 3. */
export const WIDE_RUNS = [2, 4] as const
export const NARROW_RUNS = [1, 3] as const
export const PHONE_RUN_W = 640
/** Length of a run in core-band heights: mostly SHORT, at most one pane-wide run up to LONG_MAX. */
export const RUN_LEN_H = { min: 0.7, short: 2.0, long: 3.4 }
/** Two starts on the same pane keep this far apart in x, css px. */
export const RUN_SPACING_CSS = 60
/** Path of a run: wavelengths of the two sines, css px, and the bounds of the amplitude and of the lean. */
export const RUN_WAVE1_CSS = 64
export const RUN_WAVE2_CSS = 27
export const RUN_AMP_CSS = { lo: 1.2, hi: 4 }
export const RUN_LEAN_MAX = 0.05
/** The start ramp of the path: the offset is 0 at the head of the run and reaches full amplitude after this many css px. */
export const RUN_RAMP_CSS = 18
/** Dark ink for a run start, 0..255, and clear glass below it. */
export const DARK_A = 153
export const CLEAR_A = 51
/** Minimum spacing between two starts in the same group, note px. */
export const MIN_SPACING_PX = 90
/** The head stops at least this far above the bottom of the glass, css px. */
export const SILL_CLEARANCE_CSS = 24
export const MIN_RUN_CSS = 10

/** Deterministic 32-bit mix to [0, 1). */
export function hash01(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export interface PlanInput {
  /** w*h, the scan's ink alpha 0..255. */
  ink: ArrayLike<number>
  /** RGBA bytes of the time-of-ink map: G is the reveal time. */
  toi: ArrayLike<number>
  width: number
  height: number
  groups: readonly PlanGroup[]
}

interface Candidate {
  group: number
  x: number
  y: number
  mass: number
  score: number
}

/**
 * Candidates are the bottoms of vertical runs of dark ink with clear glass under them. The heaviest win; a seeded jitter
 * breaks ties; starts keep `MIN_SPACING_PX` apart within a group. Returns MIN_RUNS to MAX_RUNS runs when the scan has them.
 */
export function planDrips(input: PlanInput, seed: number): PlannedRun[] {
  const { ink, toi, width: w, height: h, groups } = input
  const cands: Candidate[] = []
  groups.forEach((g, gi) => {
    const [x0, y0, x1, y1] = g.rect
    for (let x = x0; x < x1; x++) {
      let runStart = -1
      let mass = 0
      for (let y = y0; y <= y1; y++) {
        const a = y < h ? ink[y * w + x] : 0
        if (a >= DARK_A) {
          if (runStart < 0) runStart = y
          mass += a / 255
        } else if (runStart >= 0) {
          const len = y - runStart
          let clear = true
          for (let k = 0; k < 3; k++) if (y + k < h && ink[(y + k) * w + x] >= CLEAR_A) clear = false
          if (len >= 4 && clear) {
            cands.push({ group: gi, x, y: y - 1, mass, score: mass * (0.85 + 0.3 * hash01(seed, x, y)) })
          }
          runStart = -1
          mass = 0
        }
      }
    }
  })
  cands.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y)
  const picked: Candidate[] = []
  for (const c of cands) {
    if (picked.length >= MAX_RUNS) break
    if (picked.some((p) => Math.abs(p.x - c.x) < MIN_SPACING_PX && (p.group === c.group || Math.abs(p.x - c.x) < 40))) continue
    picked.push(c)
  }
  return picked.map((c, i) => ({
    group: c.group,
    x: c.x + 0.5,
    y: c.y + 1,
    mass: c.mass,
    u0: (toi[(c.y * w + c.x) * 4 + 1] ?? 0) / 255,
    delayMs: 250 + 600 * hash01(seed, i, 1),
    r: [hash01(seed, i, 2), hash01(seed, i, 3), hash01(seed, i, 4), hash01(seed, i, 5)],
  }))
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** A run placed on screen, css px. */
export interface PlacedRun {
  /** Start, css px in the pane. */
  x: number
  y0: number
  /** Total travel limit, css px (the head never goes beyond it). */
  len: number
  /** Reveal-clock ms at which the run starts moving. */
  tStart: number
  /** First slide: length and duration; optional second slide after a pause. */
  len1: number
  dur1: number
  pause: number
  len2: number
  dur2: number
  halfWidth: number
  headR: number
  seed: number
  /** Time-of-ink of the stroke, 0..1. */
  u0: number
  /** Path: amplitude (css px) of the meander and the lean (css px of x per css px of y). */
  amp: number
  lean: number
  /** Length of the wider lip at the start, css px. */
  lip: number
}

const smooth = (x: number): number => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/** x offset of the channel at `dy` css px below the start. 0 at the start; |offset| <= amp + |lean| * dy. The GLSL twin has the same formula. */
export function runOffset(run: Pick<PlacedRun, 'amp' | 'lean' | 'seed'>, dy: number): number {
  const k1 = (2 * Math.PI) / RUN_WAVE1_CSS
  const k2 = (2 * Math.PI) / RUN_WAVE2_CSS
  const w = 0.62 * Math.sin(dy * k1 + run.seed) + 0.38 * Math.sin(dy * k2 + run.seed * 2.3)
  return smooth(dy / RUN_RAMP_CSS) * run.amp * w + run.lean * dy
}

/** Accelerates quickly, decelerates to a stall; 0 at 0, 1 at 1, never decreasing. */
export function progress(x: number): number {
  const s = clamp01(Math.pow(clamp01(x), 0.7))
  return s * s * s * (s * (s * 6 - 15) + 10)
}

/** Distance the head has travelled below its start at reveal-clock `tMs`, css px. Pure; monotone in t; at most `run.len`. */
export function dripDistance(run: PlacedRun, tMs: number): number {
  const t = tMs - run.tStart
  if (!(t > 0)) return 0
  let d = run.len1 * progress(t / run.dur1)
  if (run.len2 > 0) d += run.len2 * progress((t - run.dur1 - run.pause) / run.dur2)
  return Math.min(d, run.len)
}

/** Reveal-clock ms at which the run has stopped for good. */
export function dripEnd(run: PlacedRun): number {
  return run.tStart + run.dur1 + (run.len2 > 0 ? run.pause + run.dur2 : 0)
}

/**
 * Maps the plan to css px for a layout and picks which candidates run. A wide pane shows 2 to 4 runs, a phone 1 to 3, in an
 * order a seeded key shuffles (so not every word sheds one). Lengths are counted in core-band heights `H` of the stroke's
 * group: mostly 0.5 to 2 H, and at most one longer run (up to 3.2 H). A run needs room: at least half a core band above the
 * sill clearance and above any group below it.
 */
export function placeDrips(plan: readonly PlannedRun[], layout: Layout, paneW: number, paneH: number, seed: number): PlacedRun[] {
  interface Cand {
    run: PlannedRun
    x: number
    y0: number
    room: number
    H: number
    key: number
    scale: number
  }
  const cands: Cand[] = []
  plan.forEach((p, idx) => {
    const pl = layout.groups.find((g) => p.x >= g.src[0] && p.x <= g.src[2] && p.y >= g.src[1] && p.y <= g.src[3] && g.index === p.group)
    if (!pl) return
    const x = pl.dst[0] + (p.x - pl.src[0]) * pl.scale
    const y0 = pl.dst[1] + (p.y - pl.src[1]) * pl.scale
    if (x < 8 || x > paneW - 8) return
    let room = paneH - SILL_CLEARANCE_CSS - y0
    for (const q of layout.groups) {
      if (q === pl) continue
      if (q.inked[1] > y0 && x > q.inked[0] - 8 && x < q.inked[2] + 8) room = Math.min(room, q.inked[1] - 8 - y0)
    }
    const H = Math.max(12, pl.coreBandCssPx)
    if (room < Math.max(MIN_RUN_CSS, 0.5 * H)) return
    cands.push({ run: p, x, y0, room, H, key: idx + 2.6 * hash01(seed, idx, 77) - (room >= 1.2 * H ? 1.6 : 0), scale: pl.scale })
  })
  cands.sort((a, b) => a.key - b.key)
  const [lo, hi] = paneW > PHONE_RUN_W ? WIDE_RUNS : NARROW_RUNS
  const want = lo + Math.floor(hash01(seed, 5, 9) * (hi - lo + 1))
  const chosen: Cand[] = []
  for (const c of cands) {
    if (chosen.length >= Math.min(want, MAX_RUNS)) break
    if (chosen.some((o) => Math.abs(o.x - c.x) < RUN_SPACING_CSS)) continue
    chosen.push(c)
  }
  // At most one long run: of the chosen candidates with room for it, the one with the highest seeded draw.
  let longAt = -1
  let best = -1
  chosen.forEach((c, i) => {
    if (c.room >= 2.2 * c.H && c.run.r[0] > best) {
      best = c.run.r[0]
      longAt = i
    }
  })
  return chosen.map((c, i) => {
    const p = c.run
    const kk = Math.min(1.2, Math.max(0.7, c.H / 40))
    const isLong = i === longAt
    const heights = isLong
      ? 2.2 + (RUN_LEN_H.long - 2.2) * p.r[0]
      : RUN_LEN_H.min + (RUN_LEN_H.short - RUN_LEN_H.min) * Math.pow(p.r[0], 1.3)
    const len = Math.min(heights * c.H, c.room)
    const two = isLong && p.r[2] > 0.3 && len > 1.4 * c.H
    const len1 = two ? len * 0.62 : len
    const len2 = two ? len - len1 : 0
    const halfWidth = Math.max(0.9, Math.min(1.7, (1.0 + 0.7 * kk) * (0.88 + 0.24 * Math.min(p.mass / 8, 1))))
    const sd = hash01(seed, Math.round(p.x), Math.round(p.y)) * 100
    return {
      x: c.x,
      y0: c.y0,
      len,
      tStart: p.u0 * WRITE_ON_MS + p.delayMs,
      len1,
      dur1: (700 + 700 * p.r[1]) * Math.sqrt(Math.max(0.4, len / (1.2 * c.H))),
      pause: 500 + 600 * p.r[3],
      len2,
      dur2: 700 + 500 * p.r[1],
      halfWidth,
      headR: Math.max(2.3 * (0.7 + 0.6 * (kk - 0.7)), halfWidth * (1.9 + 0.5 * p.r[3])) * (paneW > PHONE_RUN_W ? 1 : 0.85),
      seed: sd,
      u0: p.u0,
      amp: Math.min(RUN_AMP_CSS.hi, Math.max(RUN_AMP_CSS.lo, (1.6 + 1.8 * p.r[3]) * kk)),
      lean: (hash01(seed, Math.round(p.x), 31) - 0.5) * 2 * RUN_LEAN_MAX,
      lip: Math.min(0.9 * c.H, 22),
    }
  })
}

/**
 * Writes one run into the two uniform vec4 arrays (device px): A = (x, y0, yHead, halfWidth), B = (headRadius, secondsSinceStall,
 * seed, started), C = (meander amplitude px, lean, lip length px, total length px). No allocation.
 */
export function writeRunUniforms(run: PlacedRun, tMs: number, ratio: number, a: Float32Array, b: Float32Array, c: Float32Array, k: number): void {
  const d = dripDistance(run, tMs)
  const started = tMs > run.tStart ? 1 : 0
  a[4 * k] = run.x * ratio
  a[4 * k + 1] = run.y0 * ratio
  a[4 * k + 2] = (run.y0 + d) * ratio
  a[4 * k + 3] = run.halfWidth * ratio
  b[4 * k] = run.headR * ratio
  b[4 * k + 1] = Math.max(0, (tMs - dripEnd(run)) / 1000)
  b[4 * k + 2] = run.seed
  b[4 * k + 3] = started
  c[4 * k] = run.amp * ratio
  c[4 * k + 1] = run.lean
  c[4 * k + 2] = run.lip * ratio
  c[4 * k + 3] = run.len * ratio
}
