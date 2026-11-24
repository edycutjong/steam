// Word alignment from gaps in the owned ink (R18 to R20).

import { RUN_MIN_PX, RUN_RATIO, WORD_INK_MIN_PX, WORD_SHAPE_RATIO_MAX } from './constants.ts'
import { assignGroups, isComponentBoundary, type CuratorEntry, type PartComponent } from './partition.ts'
import { charCount } from './plausible.ts'
import { shearedColumn, type LinePixels, type Run } from './runs.ts'

export type AlignAuto =
  | { ok: true; chosen: Run[]; /** Centre column of each chosen run, left to right. */ boundaries: number[] }
  | { ok: false; reason: 'alignment ambiguous'; detail: string; runsFound: number; kthWidth: number | null; nextWidth: number | null; needWidth: number }
  | { ok: false; reason: 'word without ink'; detail: string; wordInk: number[] }
  | { ok: false; reason: 'alignment implausible'; detail: string }

/** Ink held by each word box of a candidate cut at `boundaries` (sorted). Given by the caller, who owns the pixels. */
export type WordInk = (boundaries: number[]) => number[]

/**
 * Whether a candidate cut is implausible (plausible.ts: word shape, cut-through): the reason, or null. Given by the caller,
 * who knows the reading and the ink. Judged after the ink floor, on candidates that are otherwise accepted.
 */
export type Implausible = (boundaries: number[], boxOfWord?: number[]) => string | null

/** The word boxes of a candidate that hold less than the floor: `word 0 holds 4 ink px`. Null when every box holds enough. */
function inklessWords(boundaries: number[], wordInk: WordInk | undefined): { wordInk: number[]; detail: string } | null {
  if (!wordInk) return null
  const counts = wordInk(boundaries)
  const bad = counts.flatMap((n, j) => (n < WORD_INK_MIN_PX ? [`word ${j} holds ${n} ink px`] : []))
  return bad.length ? { wordInk: counts, detail: `alignment rejected: ${bad.join(', ')}, under the floor ${WORD_INK_MIN_PX}` } : null
}

const median = (v: number[]): number => {
  const a = [...v].sort((x, y) => x - y)
  if (a.length === 0) return RUN_MIN_PX
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2
}

/**
 * R18.3, R18.4. Rank the runs by width (ties: left first), take the widest k-1 as word boundaries. Accept only when
 * at least k-1 runs exist, the (k-1)th is strictly wider than the next, and it is at least 1.5 x the median width
 * of the unselected runs (4 when there are none). Then, when `wordInk` is given, every word box of the result must hold
 * at least WORD_INK_MIN_PX ink pixels; otherwise the candidate is rejected whatever its run widths.
 */
export function alignAuto(runs: Run[], k: number, wordInk?: WordInk, implausible?: Implausible): AlignAuto {
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
  const boundaries = chosen.map((r) => Math.floor((r.x0 + r.x1) / 2))
  const empty = inklessWords(boundaries, wordInk)
  if (empty) return { ok: false, reason: 'word without ink', detail: empty.detail, wordInk: empty.wordInk }
  const why = implausible?.(boundaries) ?? null
  if (why) return { ok: false, reason: 'alignment implausible', detail: `alignment implausible: ${why}` }
  return { ok: true, chosen, boundaries }
}

/**
 * The boundaries the automatic rule would take before its acceptance test (the widest k-1 runs, ties left first).
 * Used only to score a rejected automatic alignment against the fixture (R20.3); never shipped.
 */
export function candidateBoundaries(runs: Run[], k: number): number[] | null {
  if (k - 1 > runs.length) return null
  return [...runs]
    .sort((a, b) => b.width - a.width || a.x0 - b.x0)
    .slice(0, k - 1)
    .sort((a, b) => a.x0 - b.x0)
    .map((r) => Math.floor((r.x0 + r.x1) / 2))
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

export type AlignCurator =
  | { ok: true; chosen: Run[]; boundaries: number[]; /** Box of each word, only when `null` entries merged words into one box. */ boxOfWord?: number[] }
  | { ok: false; detail: string }

/**
 * R19.3: boundaries are indices into the code-found runs, never coordinates. One entry per gap between neighbouring words
 * (k-1 entries). An entry is a valid run index, or `null` when no code-found run separates those two words (a stroke joins
 * them): the words then share one box. Indices are distinct; with a `null` they must also rise from left to right.
 */
export function alignCurator(runs: Run[], k: number, indices: (number | null)[], wordInk?: WordInk, implausible?: Implausible): AlignCurator {
  if (indices.length !== k - 1) return { ok: false, detail: `alignment.json names ${indices.length} boundary runs, the line has ${k} words and needs ${k - 1}` }
  const named = indices.filter((i): i is number => i !== null)
  if (new Set(named).size !== named.length) return { ok: false, detail: 'alignment.json repeats a boundary run index' }
  for (const i of named) if (!Number.isInteger(i) || i < 0 || i >= runs.length) return { ok: false, detail: `alignment.json run index ${i} is out of range (the line has ${runs.length} runs)` }
  const merged = named.length !== indices.length
  if (merged && named.some((v, j) => j > 0 && v < named[j - 1]!)) return { ok: false, detail: 'alignment.json: boundary runs with a null must be listed from left to right' }
  const chosen = named.map((i) => runs[i]!).sort((a, b) => a.x0 - b.x0)
  const boundaries = chosen.map((r) => Math.floor((r.x0 + r.x1) / 2))
  let boxOfWord: number[] | undefined
  if (merged) {
    boxOfWord = [0]
    for (const i of indices) boxOfWord.push(boxOfWord[boxOfWord.length - 1]! + (i === null ? 0 : 1))
  }
  const empty = inklessWords(boundaries, wordInk)
  if (empty) return { ok: false, detail: `alignment.json: ${empty.detail}` }
  const why = implausible?.(boundaries, boxOfWord) ?? null
  if (why) return { ok: false, detail: `alignment.json: alignment implausible: ${why}` }
  return { ok: true, chosen, boundaries, ...(boxOfWord ? { boxOfWord } : {}) }
}

/** What a component-partition part carries (R19.8 to R19.15): the chosen boundaries and the components of the quoted group. */
export interface PartPartition {
  /** The `after` id of each chosen boundary, left to right. */
  after: number[]
  /** Ids of the components of the quoted group, in order: the only components the note may show on this line. */
  allowed: number[]
  /** Number of the quoted group (0 for the leftmost). */
  quotedGroup: number
}

export interface PartAlignment {
  line: number
  fromWord: number
  toWord: number
  method: AlignMethod
  /** Sheared boundary columns (empty for whole lines and for a component partition). */
  boundaries: number[]
  /** `component` when the part is cut by a component partition (R19.8), absent otherwise. */
  boundary?: 'component'
  partition?: PartPartition
  /** The box (between neighbouring boundaries) that the quote's first and last word lie in, when a curator merged words into shared boxes; else the words themselves are the boxes. */
  fromBox?: number
  toBox?: number
  /** The line's text extent [lo, hi] (sheared columns) the word regions are clipped to; absent for whole lines. */
  extent?: [number, number]
  /** Why whole lines were used, when they were. */
  reason?: string
  /** What the automatic attempt said, always recorded (R20.3). */
  autoDetail: string
}

export type AlignComponents =
  | { ok: true; after: number[]; allowed: number[]; quotedGroup: number; boxOfWord: number[] }
  | { ok: false; detail: string }

/**
 * R19.10 to R19.13. `entries` has one entry per gap between words (k-1): `{kind: "component", after}` where the note has an edge,
 * `null` elsewhere. Returns the groups of the quote, or why the part cannot be cut by components (it then falls to whole lines).
 */
export function alignComponents(order: PartComponent[] | undefined, k: number, entries: CuratorEntry[], quote: { fromWord: number; toWord: number }, tokens: string[] | undefined): AlignComponents {
  if (entries.length !== k - 1) return { ok: false, detail: `alignment.json names ${entries.length} boundary runs, the line has ${k} words and needs ${k - 1}` }
  if (entries.some((e) => typeof e === 'number')) return { ok: false, detail: 'alignment.json: a line may not mix run boundaries and component boundaries' }
  if (!order) return { ok: false, detail: "alignment.json: a component boundary needs the line's components (none were given)" }
  const { fromWord, toWord } = quote
  const gaps: number[] = []
  for (let g = 0; g < entries.length; g++) {
    if (entries[g] === null) continue
    gaps.push(g)
    // R19.11: only at an edge of the note; the words inside a note stay together
    if (g !== fromWord - 1 && g !== toWord) return { ok: false, detail: `alignment.json: the component boundary at gap ${g} lies inside the quote (words ${fromWord} to ${toWord}); the words inside a note stay together` }
  }
  const after = gaps.map((g) => (entries[g] as { after: number }).after)
  let groups: Map<number, number>
  try {
    groups = assignGroups(order, after)
  } catch (e) {
    return { ok: false, detail: `alignment.json: ${(e as Error).message}` }
  }
  // the box (group) of each word: a null keeps the words around it together
  const boxOfWord = [0]
  for (let g = 0; g < entries.length; g++) boxOfWord.push(boxOfWord[boxOfWord.length - 1]! + (entries[g] === null ? 0 : 1))
  if ((fromWord > 0 && boxOfWord[fromWord - 1] === boxOfWord[fromWord]) || (toWord < k - 1 && boxOfWord[toWord] === boxOfWord[toWord + 1]))
    return { ok: false, detail: 'alignment.json: the quote starts or ends inside a box that merges words (no component boundary at that edge)' }
  // ink floor on every group
  const ink = new Array<number>(after.length + 1).fill(0)
  for (const c of order) ink[groups.get(c.id)!]! += c.ink
  const thin = ink.flatMap((n, j) => (n < WORD_INK_MIN_PX ? [`group ${j} holds ${n} ink px`] : []))
  if (thin.length) return { ok: false, detail: `alignment.json: alignment rejected: ${thin.join(', ')}, under the floor ${WORD_INK_MIN_PX}` }
  // ink share of the quoted group against the character share of the quoted words (the factor of the word shape test)
  const quotedGroup = boxOfWord[fromWord]!
  if (tokens && tokens.length === k) {
    const total = ink.reduce((a, b) => a + b, 0)
    const chars = tokens.map(charCount)
    const C = chars.reduce((a, b) => a + b, 0)
    const cq = chars.slice(fromWord, toWord + 1).reduce((a, b) => a + b, 0)
    const iq = ink[quotedGroup]!
    const ratio = iq / total / (cq / C)
    if (iq * C > WORD_SHAPE_RATIO_MAX * cq * total || WORD_SHAPE_RATIO_MAX * iq * C < cq * total)
      return {
        ok: false,
        detail: `alignment.json: alignment implausible: ink share of the quoted words ${(iq / total).toFixed(3)} against character share ${(cq / C).toFixed(3)} (ratio ${ratio.toFixed(2)}, allowed ${1 / WORD_SHAPE_RATIO_MAX} to ${WORD_SHAPE_RATIO_MAX})`,
      }
  }
  const allowed = order.filter((c) => groups.get(c.id) === quotedGroup).map((c) => c.id)
  return { ok: true, after, allowed, quotedGroup, boxOfWord }
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
  curator?: CuratorEntry[]
  /** The line's owned components in order (partition.ts), for component boundaries. */
  partition?: PartComponent[]
  /** The scribe's tokens of the line: the characters of the quoted words (ink share against character share). */
  tokens?: string[]
  /** The runs a curator's indices name: the runs of runs.json (segment time). Defaults to `runs`. */
  curatorRuns?: Run[]
  /** The line's text extent (runs.ts): word regions of an aligned part are clipped to it. */
  extent?: [number, number]
  /** Ink per word box of a candidate (the floor test); without it no floor is applied. */
  wordInk?: WordInk
  /** Plausibility of a candidate cut against the reading and the ink (the same test for the automatic and the curator candidate). */
  implausible?: Implausible
}

/** Method order per part: auto, then curator, then whole lines (R19). */
export function alignPart(p: PartInput): PartAlignment {
  const base = { line: p.line, fromWord: p.fromWord, toWord: p.toWord }
  if (p.fromWord === 0 && p.toWord === p.tokenCount - 1) return { ...base, method: 'lines', boundaries: [], reason: 'the whole line is quoted', autoDetail: 'not attempted: whole line quoted' }
  if (p.k === null) return { ...base, method: 'lines', boundaries: [], reason: 'word count unknown: the readers disagree on the token count', autoDetail: 'not attempted: word count unknown' }
  const auto = alignAuto(p.runs, p.k, p.wordInk, p.implausible)
  const ext = p.extent ? { extent: p.extent } : {}
  if (auto.ok) return { ...base, method: 'auto', boundaries: auto.boundaries, ...ext, autoDetail: `accepted: ${auto.chosen.length} boundaries` }
  if (p.curator && p.curator.some(isComponentBoundary)) {
    const c = alignComponents(p.partition, p.k, p.curator, p, p.tokens)
    if (!c.ok) return { ...base, method: 'lines', boundaries: [], reason: c.detail, autoDetail: auto.detail }
    return {
      ...base, method: 'curator', boundaries: [], boundary: 'component', partition: { after: c.after, allowed: c.allowed, quotedGroup: c.quotedGroup },
      fromBox: c.boxOfWord[p.fromWord]!, toBox: c.boxOfWord[p.toWord]!, ...ext, autoDetail: auto.detail,
    }
  }
  if (p.curator) {
    const c = alignCurator(p.curatorRuns ?? p.runs, p.k, p.curator as (number | null)[], p.wordInk, p.implausible)
    if (c.ok && c.boxOfWord) {
      const box = c.boxOfWord
      // a quote may not cut a shared box: it would show words that are not quoted
      const splits = box[p.fromWord - 1] === box[p.fromWord] || box[p.toWord] === box[p.toWord + 1]
      if (splits) return { ...base, method: 'lines', boundaries: [], reason: 'alignment.json: the quote starts or ends inside a box that merges words (no code-found gap separates them)', autoDetail: auto.detail }
      return { ...base, method: 'curator', boundaries: c.boundaries, fromBox: box[p.fromWord]!, toBox: box[p.toWord]!, ...ext, autoDetail: auto.detail }
    }
    if (c.ok) return { ...base, method: 'curator', boundaries: c.boundaries, ...ext, autoDetail: auto.detail }
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

// ---------------------------------------------------------------------------------------------------------------
// Scoring against the hero fixture (R20). The fixture boxes are read only here and cut no pixel.

export interface FixtureWord {
  word: string
  box: [number, number, number, number]
}

const norm = (w: string): string => w.toLowerCase().replace(/[.,;:!?]+$/, '')

/** Index in `shown` tokens where the fixture words start, matched in order ignoring case and trailing punctuation (R20.1). */
export function matchFixtureWords(shownText: string, words: FixtureWord[]): number | null {
  const t = shownText.split(/\s+/).filter(Boolean).map(norm)
  const f = words.map((w) => norm(w.word))
  for (let s = 0; s + f.length <= t.length; s++) if (f.every((w, k) => t[s + k] === w)) return s
  return null
}

export interface WordScore {
  word: string
  recall: number
  /** null when the note's mask is not cut by words (whole lines): no pixel has a word to compare. */
  precision: number | null
  rawPx: number
  maskPx: number
}
export interface FixtureScore {
  words: WordScore[]
  /** Share of the note's mask pixels that lie inside some fixture box (set by the gate; scoring only). */
  precision?: number
  /** |rawInk ∩ ∪boxes ∩ lit| / |rawInk ∩ ∪boxes| (R27.4). */
  recall: number
}

/**
 * `raw` is the fixture frame's rawInk; `lit(x, y)` says whether the shipped note has alpha > 0 at a fixture-frame pixel;
 * `maskWords` lists the note's mask pixels in the fixture frame with their word number in `shownText`.
 * Box j is compared with shown word `offset + j`.
 */
export function scoreAgainstFixture(
  raw: Uint8Array,
  width: number,
  words: FixtureWord[],
  offset: number,
  lit: (x: number, y: number) => boolean,
  maskWords: { x: number; y: number; word: number }[],
): FixtureScore {
  const inBox = (b: [number, number, number, number], x: number, y: number) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]
  const scores: WordScore[] = words.map((w, j) => {
    let rawPx = 0
    let kept = 0
    const [x0, y0, x1, y1] = w.box
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (raw[y * width + x]) {
          rawPx++
          if (lit(x, y)) kept++
        }
    const mine = maskWords.filter((p) => p.word === offset + j)
    const inside = mine.filter((p) => inBox(w.box, p.x, p.y)).length
    return { word: w.word, recall: rawPx ? kept / rawPx : 0, precision: mine.length ? inside / mine.length : null, rawPx, maskPx: mine.length }
  })
  // union of boxes
  let tot = 0
  let kept = 0
  const xs0 = Math.min(...words.map((w) => w.box[0]))
  const ys0 = Math.min(...words.map((w) => w.box[1]))
  const xs1 = Math.max(...words.map((w) => w.box[2]))
  const ys1 = Math.max(...words.map((w) => w.box[3]))
  for (let y = ys0; y < ys1; y++)
    for (let x = xs0; x < xs1; x++) {
      if (!raw[y * width + x] || !words.some((w) => inBox(w.box, x, y))) continue
      tot++
      if (lit(x, y)) kept++
    }
  return { words: scores, recall: tot ? kept / tot : 0 }
}
