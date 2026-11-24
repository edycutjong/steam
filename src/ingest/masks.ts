// Ink ownership (R10), split share (R12), review (R13) and ownership artifacts (R11).

import { MIN_COMPONENT_PX } from './constants.ts'
import type { Labels } from './components.ts'

export interface Bands {
  /** Inclusive core band rows per line, top to bottom. */
  cores: [number, number][]
  /** valleys[i] lies between line i and line i+1. */
  valleys: number[]
}

export interface SplitLog {
  componentId: number
  rows: [number, number]
  valleyRows: number[]
  lines: number[]
  pixelsPerLine: number[]
  totalPixels: number
}

export interface CompInfo {
  id: number
  size: number
  /** Inclusive first and last row. */
  rows: [number, number]
  /** Lines whose core band contains at least one row of the component (ascending). */
  touched: number[]
  /** Centroid row. */
  cy: number
  /** True when the component is at least 30 px, touches two or more core bands, and was cut at valley rows. */
  split: boolean
  /** True when a review decision decided this component. */
  reviewed: boolean
}

export interface Ownership {
  width: number
  height: number
  /** Line index per pixel, -1 where there is no ink. */
  owner: Int16Array
  components: Map<number, CompInfo>
  splits: SplitLog[]
}

/** Nearest core band to a row: distance 0 inside a band, else the gap to the nearest edge; ties go to the upper line. */
export function nearestBand(row: number, cores: [number, number][]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < cores.length; i++) {
    const [a, b] = cores[i]!
    const d = row < a ? a - row : row > b ? row - b : 0
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function ownership(labels: Labels, bands: Bands): Ownership {
  const { width: w, height: h } = labels
  const n = bands.cores.length
  const bandOfRow = new Int16Array(h).fill(-1)
  bands.cores.forEach(([a, b], i) => {
    for (let y = Math.max(0, a); y <= Math.min(h - 1, b); y++) bandOfRow[y] = i
  })
  const info = new Map<number, CompInfo>()
  const sumY = new Map<number, number>()
  const touchSet = new Map<number, Set<number>>()
  for (const id of labels.ids) {
    info.set(id, { id, size: labels.size.get(id)!, rows: [h, -1], touched: [], cy: 0, split: false, reviewed: false })
    sumY.set(id, 0)
    touchSet.set(id, new Set())
  }
  for (let y = 0; y < h; y++) {
    const band = bandOfRow[y]!
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      if (id < 0) continue
      const c = info.get(id)!
      if (y < c.rows[0]) c.rows[0] = y
      if (y > c.rows[1]) c.rows[1] = y
      sumY.set(id, sumY.get(id)! + y)
      if (band >= 0) touchSet.get(id)!.add(band)
    }
  }
  for (const [id, c] of info) {
    c.touched = [...touchSet.get(id)!].sort((a, b) => a - b)
    c.cy = sumY.get(id)! / c.size
    c.split = c.size >= MIN_COMPONENT_PX && c.touched.length >= 2
  }
  const owner = new Int16Array(w * h).fill(-1)
  const perLine = new Map<number, number[]>()
  const cutRows = (c: CompInfo): number[] => c.touched.slice(0, -1).map((t) => bands.valleys[t]!)
  const lineFor = (c: CompInfo, y: number): number => {
    if (c.size < MIN_COMPONENT_PX || c.touched.length === 0) return nearestBand(c.cy, bands.cores)
    if (c.touched.length === 1) return c.touched[0]!
    const cuts = cutRows(c)
    let k = 0
    while (k < cuts.length && y >= cuts[k]!) k++
    return c.touched[k]!
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      if (id < 0) continue
      const c = info.get(id)!
      const l = lineFor(c, y)
      owner[y * w + x] = l
      if (c.split) {
        let arr = perLine.get(id)
        if (!arr) perLine.set(id, (arr = new Array<number>(n).fill(0)))
        arr[l]!++
      }
    }
  const splits: SplitLog[] = []
  for (const [id, c] of info) {
    if (!c.split) continue
    const arr = perLine.get(id)!
    const lines = c.touched
    splits.push({ componentId: id, rows: [c.rows[0], c.rows[1]], valleyRows: cutRows(c), lines, pixelsPerLine: lines.map((l) => arr[l]!), totalPixels: c.size })
  }
  return { width: w, height: h, owner, components: info, splits }
}
