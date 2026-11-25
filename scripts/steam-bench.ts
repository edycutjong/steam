// The pure part of scripts/measure-steam.ts: the five profiles and the statistics of one row. No browser here, so it is unit-tested.
import { z } from 'zod'

export const MIN_FPS = 55
export const MAX_FRAME_MS = 1000 / MIN_FPS

export interface Profile {
  name: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  mobile: boolean
  cpuThrottle: number
  /** Chromium software GL (ANGLE SwiftShader), whatever the machine's GPU is. */
  software: boolean
  /** Query appended to the hero route. `gov=1` lets the quality governor act under automation. The overlay (`fps=1`) is left out where the pane is being captured. */
  query: string
  /** A row that sets the budget. Software GL is recorded for the record and does not fail the run. */
  budget: boolean
}

export const PROFILES: Profile[] = [
  { name: 'desktop-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, software: false, query: '?fps=1&gov=1', budget: true },
  { name: 'desktop-1920x1080', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, software: false, query: '?fps=1&gov=1', budget: true },
  { name: 'pixel5-4x-cpu', viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, mobile: true, cpuThrottle: 4, software: false, query: '?fps=1&gov=1', budget: true },
  { name: 'swiftshader-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, software: true, query: '?fps=1&gov=1', budget: false },
  // The video-capture setup: the same pane at 1920x1080, dpr 1, with no overlay on screen.
  { name: 'capture-1920x1080', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, software: false, query: '?gov=1', budget: true },
]

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

const r2 = (x: number): number => Number(x.toFixed(2))

export const BenchRow = z.object({
  name: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  deviceScaleFactor: z.number(),
  cpuThrottle: z.number(),
  software: z.boolean(),
  budget: z.boolean(),
  durationMs: z.number(),
  frames: z.number(),
  avgFps: z.number(),
  /** The 5th-percentile frame rate: 1000 / p95 frame time. */
  p5Fps: z.number(),
  framesUnder55Fps: z.number(),
  p50FrameMs: z.number(),
  p95FrameMs: z.number(),
  worstFrameMs: z.number(),
  /** The governor's tier at the end of the run (0 = full quality, 3 = static pane). */
  tier: z.number().int().min(0).max(3),
  gpuRenderer: z.string().nullable(),
  gpuVendor: z.string().nullable(),
  deriveMs: z.number().nullable(),
  pass: z.boolean(),
})
export type BenchRow = z.infer<typeof BenchRow>

export interface RunInfo {
  tier: number
  gpuRenderer: string | null
  gpuVendor: string | null
  deriveMs: number | null
}

/** One row from the requestAnimationFrame intervals (ms) of a run. */
export function summarize(profile: Profile, intervals: number[], info: RunInfo): BenchRow {
  const sorted = [...intervals].sort((a, b) => a - b)
  const totalMs = intervals.reduce((s, v) => s + v, 0)
  const under = intervals.filter((v) => v > MAX_FRAME_MS).length
  const avgFps = totalMs > 0 ? (intervals.length * 1000) / totalMs : 0
  const p95 = percentile(sorted, 95)
  return {
    name: profile.name,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    cpuThrottle: profile.cpuThrottle,
    software: profile.software,
    budget: profile.budget,
    durationMs: Math.round(totalMs),
    frames: intervals.length,
    avgFps: r2(avgFps),
    p5Fps: p95 > 0 ? r2(1000 / p95) : 0,
    framesUnder55Fps: under,
    p50FrameMs: r2(percentile(sorted, 50)),
    p95FrameMs: r2(p95),
    worstFrameMs: r2(sorted[sorted.length - 1] ?? Number.NaN),
    tier: info.tier,
    gpuRenderer: info.gpuRenderer,
    gpuVendor: info.gpuVendor,
    deriveMs: info.deriveMs === null ? null : Number(info.deriveMs.toFixed(1)),
    pass: avgFps >= MIN_FPS && under === 0,
  }
}
