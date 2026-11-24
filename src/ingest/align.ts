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

// ---------------------------------------------------------------------------------------------------------------
// Fallbacks (R19) and the per-note result

export type AlignMethod = 'auto' | 'curator' | 'lines'
const RANK: Record<AlignMethod, number> = { lines: 0, curator: 1, auto: 2 }

export type AlignCurator = { ok: true; chosen: Run[]; boundaries: number[] } | { ok: false; detail: string }

/** R19.3: boundaries are indices into the code-found runs, never coordinates. Exactly k-1 distinct valid indices. */
export function alignCurator(runs: Run[], k: number, indices: number[]): AlignCurator {
  if (indices.length !== k - 1) return { ok: false, detail: `alignment.json names ${indices.length} boundary runs, the line has ${k} words and needs ${k - 1}` }
  if (new Set(indices).size !== indices.length) return { ok: false, detail: 'alignment.json repeats a boundary run index' }
  for (const i of indices) if (!Number.isInteger(i) || i < 0 || i >= runs.length) return { ok: false, detail: `alignment.json run index ${i} is out of range (the line has ${runs.length} runs)` }
  const chosen = indices.map((i) => runs[i]!).sort((a, b) => a.x0 - b.x0)
  return { ok: true, chosen, boundaries: chosen.map((r) => Math.floor((r.x0 + r.x1) / 2)) }
}

export interface PartAlignment {
  line: number
  fromWord: number
  toWord: number
  method: AlignMethod
  /** Sheared boundary columns (empty for whole lines). */
  boundaries: number[]
  /** Why whole lines were used, when they were. */
  reason?: string
  /** What the automatic attempt said, always recorded (R20.3). */
  autoDetail: string
}

export interface PartInput {
  line: number
  fromWord: number
  toWord: number
  /** Tokens of the scribe's line. */
  tokenCount: number
  /** Known word count (both readers agree), else null. */
  k: number | null
  runs: Run[]
  curator?: number[]
}

/** Method order per part: auto, then curator, then whole lines (R19). */
export function alignPart(p: PartInput): PartAlignment {
  const base = { line: p.line, fromWord: p.fromWord, toWord: p.toWord }
  if (p.fromWord === 0 && p.toWord === p.tokenCount - 1) return { ...base, method: 'lines', boundaries: [], reason: 'the whole line is quoted', autoDetail: 'not attempted: whole line quoted' }
  if (p.k === null) return { ...base, method: 'lines', boundaries: [], reason: 'word count unknown: the readers disagree on the token count', autoDetail: 'not attempted: word count unknown' }
  const auto = alignAuto(p.runs, p.k)
  if (auto.ok) return { ...base, method: 'auto', boundaries: auto.boundaries, autoDetail: `accepted: ${auto.chosen.length} boundaries` }
  if (p.curator) {
    const c = alignCurator(p.runs, p.k, p.curator)
    if (c.ok) return { ...base, method: 'curator', boundaries: c.boundaries, autoDetail: auto.detail }
    return { ...base, method: 'lines', boundaries: [], reason: c.detail, autoDetail: auto.detail }
  }
  return { ...base, method: 'lines', boundaries: [], reason: auto.detail, autoDetail: auto.detail }
}

export interface NoteAlignment {
  /** The weakest method used by any part that needed one; `lines` also when every part is a whole line (R19.6). */
  alignment: AlignMethod
  /** "words" only when at least one part is cut by words and every part that needs it was. */
  granularity: 'words' | 'lines'
}

export function noteAlignment(parts: PartAlignment[]): NoteAlignment {
  // Parts that quote a whole line need no alignment and do not weaken the note (design 3.5).
  const partial = parts.filter((p) => p.reason !== 'the whole line is quoted')
  if (partial.length === 0) return { alignment: 'lines', granularity: 'lines' }
  let weakest: AlignMethod = 'auto'
  for (const p of partial) if (RANK[p.method] < RANK[weakest]) weakest = p.method
  return { alignment: weakest, granularity: weakest === 'lines' ? 'lines' : 'words' }
}
