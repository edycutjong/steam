// The pure part of scripts/measure-cook.ts: frame statistics and the shape of bench/cook.json.
import { z } from 'zod'

export const MIN_FPS = 55
/** A frame slower than this misses 55 fps. */
export const SLOW_MS = 18.2

export function frameStats(intervals: readonly number[]) {
  const total = intervals.reduce((s, v) => s + v, 0)
  const worst = intervals.length ? Math.max(...intervals) : Number.NaN
  const meanFps = total > 0 ? (intervals.length * 1000) / total : 0
  return {
    frames: intervals.length,
    meanFps: Number(meanFps.toFixed(2)),
    minFps: Number((worst > 0 ? 1000 / worst : 0).toFixed(2)),
    worstFrameMs: Number(worst.toFixed(2)),
    over18_2ms: intervals.filter((v) => v > SLOW_MS).length,
  }
}
export const pass = (s: ReturnType<typeof frameStats>): boolean => s.meanFps >= MIN_FPS && s.over18_2ms === 0

const Profile = z.strictObject({
  name: z.string(),
  viewport: z.strictObject({ width: z.number(), height: z.number() }),
  deviceScaleFactor: z.number(),
  cpuThrottle: z.number(),
  url: z.string(),
  frames: z.number().int(),
  meanFps: z.number(),
  minFps: z.number(),
  worstFrameMs: z.number(),
  over18_2ms: z.number().int(),
  navToReadyMs: z.number().nullable(),
  navToRevealMs: z.number().nullable(),
  gpuRenderer: z.string().nullable(),
  pass: z.boolean(),
})
export const CookBench = z.strictObject({
  generatedAt: z.string(),
  command: z.string(),
  machine: z.strictObject({ cpu: z.string(), cores: z.number(), os: z.string() }),
  browser: z.string(),
  thresholds: z.strictObject({ minMeanFps: z.number(), slowFrameMs: z.number() }),
  profiles: z.array(Profile).min(1),
})
