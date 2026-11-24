// Runs of empty columns in sheared coordinates (R18.2, R18.3, R19.2). Shared by alignment and runs.json.

import { RUN_MIN_PX } from './constants.ts'
import { shear } from './slant.ts'

export interface LinePixels {
  xs: Int32Array
  ys: Int32Array
}

/** Owned pixels per line, in raster order. */
export function collectLinePixels(owner: Int16Array, width: number, height: number, nLines: number): LinePixels[] {
  const counts = new Int32Array(nLines)
  for (let i = 0; i < owner.length; i++) if (owner[i]! >= 0) counts[owner[i]!]!++
  const out: LinePixels[] = Array.from({ length: nLines }, (_, l) => ({ xs: new Int32Array(counts[l]!), ys: new Int32Array(counts[l]!) }))
  const at = new Int32Array(nLines)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = owner[y * width + x]!
      if (l < 0) continue
      const k = at[l]!++
      out[l]!.xs[k] = x
      out[l]!.ys[k] = y
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

/** Runs of at least `minRun` empty columns between the first and the last inked column. */
export function zeroRuns(p: LinePixels, yMid: number, s: number, minRun = RUN_MIN_PX): LineRuns {
  const n = p.xs.length
  if (n === 0) return { runs: [], lo: 0, hi: -1, s }
  const cols = new Int32Array(n)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    const c = shearedColumn(p.xs[i]!, p.ys[i]!, yMid, s)
    cols[i] = c
    if (c < lo) lo = c
    if (c > hi) hi = c
  }
  const occ = new Uint8Array(hi - lo + 1)
  for (let i = 0; i < n; i++) occ[cols[i]! - lo] = 1
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
