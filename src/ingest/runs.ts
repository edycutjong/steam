// Runs of empty columns in sheared coordinates (R18.2, R18.3, R19.2). Shared by alignment and runs.json.

import type { Labels } from './components.ts'
import { MIN_COMPONENT_PX, RUN_MIN_PX } from './constants.ts'
import { shear } from './slant.ts'

export interface LinePixels {
  xs: Int32Array
  ys: Int32Array
  /**
   * 1 where the pixel belongs to a component of at least MIN_COMPONENT_PX pixels (writing), 0 for a speck.
   * Absent when the component sizes were not given: every pixel then counts as writing.
   */
  big?: Uint8Array
}

/** Owned pixels per line, in raster order. With `labels`, each pixel is flagged as writing or speck. */
export function collectLinePixels(owner: Int16Array, width: number, height: number, nLines: number, labels?: Labels): LinePixels[] {
  const counts = new Int32Array(nLines)
  for (let i = 0; i < owner.length; i++) if (owner[i]! >= 0) counts[owner[i]!]!++
  const out: LinePixels[] = Array.from({ length: nLines }, (_, l) => ({
    xs: new Int32Array(counts[l]!),
    ys: new Int32Array(counts[l]!),
    ...(labels ? { big: new Uint8Array(counts[l]!) } : {}),
  }))
  const at = new Int32Array(nLines)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = owner[y * width + x]!
      if (l < 0) continue
      const k = at[l]!++
      out[l]!.xs[k] = x
      out[l]!.ys[k] = y
      if (labels) out[l]!.big![k] = labels.size.get(labels.label[y * width + x]!)! >= MIN_COMPONENT_PX ? 1 : 0
    }
  return out
}

export interface Run {
  /** Left-to-right index among the runs of this line (what a curator names, R19.3). */
  index: number
  /** First and last empty column, inclusive, in sheared coordinates. */
  x0: number
  x1: number
  width: number
}

export interface LineRuns {
  runs: Run[]
  /** First and last inked column in sheared coordinates. */
  lo: number
  hi: number
  /** The shear used. */
  s: number
}

/** x' of a pixel for a line whose vertical middle is `yMid` (rounded to a column). */
export const shearedColumn = (x: number, y: number, yMid: number, s: number): number => Math.round(shear(x, y, yMid, s))

/**
 * The text extent of a line in sheared columns: the first and last column of its writing, i.e. of the owned pixels of
 * components that are not specks. A speck (a component under MIN_COMPONENT_PX) outside the writing, such as a stray
 * mark in the margin, does not stretch it. A line with no writing pixel (or without component sizes) uses every pixel.
 */
function extentOf(p: LinePixels, cols: Int32Array): [number, number] {
  const writing = (i: number): boolean => !p.big || p.big[i] === 1
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < cols.length; i++) {
    if (!writing(i)) continue
    if (cols[i]! < lo) lo = cols[i]!
    if (cols[i]! > hi) hi = cols[i]!
  }
  if (lo > hi)
    for (let i = 0; i < cols.length; i++) {
      if (cols[i]! < lo) lo = cols[i]!
      if (cols[i]! > hi) hi = cols[i]!
    }
  return [lo, hi]
}

/**
 * Runs of at least `minRun` empty columns between the first and the last column of the line's text extent. Specks
 * inside the extent keep occupying their columns (dots, tails and marks are part of the writing); specks outside it
 * open no run and are no word.
 */
export function zeroRuns(p: LinePixels, yMid: number, s: number, minRun = RUN_MIN_PX): LineRuns {
  const n = p.xs.length
  if (n === 0) return { runs: [], lo: 0, hi: -1, s }
  const cols = new Int32Array(n)
  for (let i = 0; i < n; i++) cols[i] = shearedColumn(p.xs[i]!, p.ys[i]!, yMid, s)
  const [lo, hi] = extentOf(p, cols)
  const occ = new Uint8Array(hi - lo + 1)
  for (let i = 0; i < n; i++) if (cols[i]! >= lo && cols[i]! <= hi) occ[cols[i]! - lo] = 1
  const runs: Run[] = []
  let x = 0
  while (x < occ.length) {
    if (occ[x]) {
      x++
      continue
    }
    let e = x
    while (e + 1 < occ.length && !occ[e + 1]) e++
    if (e - x + 1 >= minRun) runs.push({ index: runs.length, x0: x + lo, x1: e + lo, width: e - x + 1 })
    x = e + 1
  }
  return { runs, lo, hi, s }
}

/**
 * Ink held by each word box of a line cut at `boundaries` (sorted sheared columns): owned pixels of writing (not
 * specks) inside the text extent [lo, hi]. The first box runs from the extent's left edge, the last to its right edge.
 */
export function wordInkCounts(p: LinePixels, yMid: number, s: number, boundaries: number[], extent: [number, number]): number[] {
  const out = new Array<number>(boundaries.length + 1).fill(0)
  for (let i = 0; i < p.xs.length; i++) {
    if (p.big && p.big[i] !== 1) continue
    const c = shearedColumn(p.xs[i]!, p.ys[i]!, yMid, s)
    if (c < extent[0] || c > extent[1]) continue
    let j = 0
    while (j < boundaries.length && c > boundaries[j]!) j++
    out[j]!++
  }
  return out
}
