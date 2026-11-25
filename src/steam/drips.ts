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
export const MIN_RUNS = 3
/** Dark ink for a run start, 0..255, and clear glass below it. */
export const DARK_A = 153
export const CLEAR_A = 51
/** Minimum spacing between two starts in the same group, note px. */
export const MIN_SPACING_PX = 90
/** The head stops at least this far above the bottom of the glass, css px. */
export const SILL_CLEARANCE_CSS = 24
export const MIN_RUN_CSS = 16

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
    delayMs: 350 + 900 * hash01(seed, i, 1),
    r: [hash01(seed, i, 2), hash01(seed, i, 3), hash01(seed, i, 4), hash01(seed, i, 5)],
  }))
}

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
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
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

/** Maps the plan to css px for a layout. Runs that have no room (under 16 css px above the sill or the group below) are dropped. */
export function placeDrips(plan: readonly PlannedRun[], layout: Layout, paneW: number, paneH: number, seed: number): PlacedRun[] {
  const out: PlacedRun[] = []
  for (const p of plan) {
    const pl = layout.groups.find((g) => p.x >= g.src[0] && p.x <= g.src[2] && p.y >= g.src[1] && p.y <= g.src[3] && g.index === p.group)
    if (!pl) continue
    const x = pl.dst[0] + (p.x - pl.src[0]) * pl.scale
    const y0 = pl.dst[1] + (p.y - pl.src[1]) * pl.scale
    if (x < 8 || x > paneW - 8) continue
    let room = paneH - SILL_CLEARANCE_CSS - y0
    for (const q of layout.groups) {
      if (q === pl) continue
      if (q.inked[1] > y0 && x > q.inked[0] - 8 && x < q.inked[2] + 8) room = Math.min(room, q.inked[1] - 8 - y0)
    }
    if (room < MIN_RUN_CSS) continue
    const want = 30 + 7 * Math.min(p.mass, 8) + 44 * p.r[0]
    const len = Math.min(want, room)
    const two = p.r[2] > 0.45 && len > 44
    const len1 = two ? len * 0.62 : len
    const len2 = two ? len - len1 : 0
    out.push({
      x,
      y0,
      len,
      tStart: p.u0 * WRITE_ON_MS + p.delayMs,
      len1,
      dur1: 900 + 900 * p.r[1],
      pause: 500 + 600 * p.r[3],
      len2,
      dur2: 700 + 500 * p.r[1],
      halfWidth: Math.min(1.7, 0.8 + 0.18 * Math.sqrt(p.mass)),
      headR: Math.min(4.2, 2.3 + 0.35 * Math.sqrt(p.mass)),
      seed: hash01(seed, Math.round(p.x), Math.round(p.y)) * 100,
      u0: p.u0,
    })
    if (out.length >= MAX_RUNS) break
  }
  return out
}

/**
 * Writes one run into the two uniform vec4 arrays (device px): A = (x, y0, yHead, halfWidth), B = (headRadius, secondsSinceStall,
 * seed, started). No allocation.
 */
export function writeRunUniforms(run: PlacedRun, tMs: number, ratio: number, a: Float32Array, b: Float32Array, k: number): void {
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
}
