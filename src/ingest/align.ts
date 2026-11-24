// Word alignment from gaps in the owned ink (R18 to R20).

import { RUN_MIN_PX, RUN_RATIO } from './constants.ts'
import { shearedColumn, type LinePixels, type Run } from './runs.ts'

export type AlignAuto =
  | { ok: true; chosen: Run[]; /** Centre column of each chosen run, left to right. */ boundaries: number[] }
  | { ok: false; reason: 'alignment ambiguous'; detail: string; runsFound: number; kthWidth: number | null; nextWidth: number | null; needWidth: number }

const median = (v: number[]): number => {
  const a = [...v].sort((x, y) => x - y)
  if (a.length === 0) return RUN_MIN_PX
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2
}

/**
 * R18.3, R18.4. Rank the runs by width (ties: left first), take the widest k-1 as word boundaries. Accept only when
 * at least k-1 runs exist, the (k-1)th is strictly wider than the next, and it is at least 1.5 x the median width
 * of the unselected runs (4 when there are none).
 */
export function alignAuto(runs: Run[], k: number): AlignAuto {
  const need = k - 1
  if (need <= 0) return { ok: true, chosen: [], boundaries: [] }
  const ranked = [...runs].sort((a, b) => b.width - a.width || a.x0 - b.x0)
  if (ranked.length < need) {
    return {
      ok: false,
      reason: 'alignment ambiguous',
      detail: `alignment ambiguous: ${ranked.length} runs, need ${need}`,
      runsFound: ranked.length,
      kthWidth: null,
      nextWidth: null,
      needWidth: RUN_RATIO * RUN_MIN_PX,
    }
  }
  const chosen = ranked.slice(0, need)
  const rest = ranked.slice(need)
  const kth = chosen[need - 1]!.width
  const next = rest.length ? rest[0]!.width : null
  const needWidth = RUN_RATIO * median(rest.map((r) => r.width))
  const ok = (next === null || kth > next) && kth >= needWidth
  if (!ok) {
    return {
      ok: false,
      reason: 'alignment ambiguous',
      detail: `alignment ambiguous: ${need}th widest run ${kth}, next ${next ?? 'none'}, ${RUN_RATIO} x median of the rest ${median(rest.map((r) => r.width))} = ${needWidth}`,
      runsFound: ranked.length,
      kthWidth: kth,
      nextWidth: next,
      needWidth,
    }
  }
  chosen.sort((a, b) => a.x0 - b.x0)
  return { ok: true, chosen, boundaries: chosen.map((r) => Math.floor((r.x0 + r.x1) / 2)) }
}

/** R18.5: word number of each pixel, by sheared column between the boundaries (sorted ascending). */
export function assignWords(p: LinePixels, yMid: number, s: number, boundaries: number[]): Uint16Array {
  const out = new Uint16Array(p.xs.length)
  for (let i = 0; i < out.length; i++) {
    const c = shearedColumn(p.xs[i]!, p.ys[i]!, yMid, s)
    let j = 0
    while (j < boundaries.length && c > boundaries[j]!) j++
    out[i] = j
  }
  return out
}
