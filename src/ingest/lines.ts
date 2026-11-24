// Row projection, line finding, separators, blocks, region and marginalia (R5, R8).

import { CORE_FRACTION, PEAK_MIN_DISTANCE, PEAK_MIN_FRACTION, PROFILE_SIGMA } from './constants.ts'

/** Ink pixels per row, over columns [x0, x1) (default: all). */
export function rowProfile(ink: Uint8Array, width: number, height: number, x0 = 0, x1 = width): Float64Array {
  const out = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = x0; x < x1; x++) n += ink[y * width + x]!
    out[y] = n
  }
  return out
}

/** Gaussian smoothing of a 1-D profile; the kernel is truncated at 3 sigma and renormalised at the borders. */
export function gaussian1d(p: Float64Array, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = new Float64Array(2 * r + 1)
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  const out = new Float64Array(p.length)
  for (let y = 0; y < p.length; y++) {
    let s = 0
    let ws = 0
    for (let i = -r; i <= r; i++) {
      const yy = y + i
      if (yy < 0 || yy >= p.length) continue
      s += p[yy]! * k[i + r]!
      ws += k[i + r]!
    }
    out[y] = s / ws
  }
  return out
}

export interface FoundLine {
  peakRow: number
  /** Inclusive rows [top, bottom] at or above 60% of the smoothed peak. */
  core: [number, number]
}
export interface FoundLines {
  lines: FoundLine[]
  /** valleys[i] lies between lines[i] and lines[i+1]. */
  valleys: number[]
  /** Median distance between neighbouring peaks, 0 with fewer than two lines. */
  pitch: number
  /** The smoothed profile the decisions were made on. */
  profile: Float64Array
}

/**
 * R8: Gaussian sigma 6 (scaled), local maxima above 25% of the global maximum, the higher of two maxima closer
 * than 40 rows (scaled), cores at 60% of the peak, valley = argmin between neighbours (lowest row on a tie).
 */
export function findLines(raw: Float64Array, scale = 1, sigma = PROFILE_SIGMA * scale): FoundLines {
  const prof = gaussian1d(raw, Math.max(sigma, 0.5))
  let max = 0
  for (const v of prof) max = Math.max(max, v)
  const minDist = PEAK_MIN_DISTANCE * scale
  const peaks: number[] = []
  if (max > 0) {
    for (let y = 1; y < prof.length - 1; y++) {
      if (prof[y]! >= prof[y - 1]! && prof[y]! > prof[y + 1]! && prof[y]! > PEAK_MIN_FRACTION * max) {
        const last = peaks[peaks.length - 1]
        if (last !== undefined && y - last < minDist) {
          if (prof[y]! > prof[last]!) peaks[peaks.length - 1] = y
        } else peaks.push(y)
      }
    }
  }
  const valleys: number[] = []
  for (let i = 0; i + 1 < peaks.length; i++) {
    const a = peaks[i]!
    const b = peaks[i + 1]!
    let best = a + 1
    for (let y = a + 1; y < b; y++) if (prof[y]! < prof[best]!) best = y
    valleys.push(best)
  }
  const lines: FoundLine[] = peaks.map((p, i) => {
    const thr = CORE_FRACTION * prof[p]!
    const lo = i > 0 ? valleys[i - 1]! + 1 : 0
    const hi = i < valleys.length ? valleys[i]! - 1 : prof.length - 1
    let a = p
    let b = p
    while (a - 1 >= lo && prof[a - 1]! >= thr) a--
    while (b + 1 <= hi && prof[b + 1]! >= thr) b++
    return { peakRow: p, core: [a, b] }
  })
  const d = peaks.slice(1).map((p, i) => p - peaks[i]!).sort((a, b) => a - b)
  const pitch = d.length === 0 ? 0 : d.length % 2 ? d[(d.length - 1) / 2]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2
  return { lines, valleys, pitch, profile: prof }
}

// ---------------------------------------------------------------------------------------------------------------
// Separators, blocks, region and marginalia (R5)

import type { Labels } from './components.ts'

export interface Separator {
  /** Inclusive rows. */
  y0: number
  y1: number
  /** Inclusive columns of the rule. */
  x0: number
  x1: number
  /** Which test fired: a component of the page, a run of ink along rows, or both. */
  method: 'component' | 'row-run' | 'component+row-run'
}

export interface SeparatorOpts {
  /** Median line pitch P. */
  pitch: number
  /** Width of the text column. */
  colWidth: number
  /** scaleOf(frame); gaps of up to 3 px x scale inside a rule are bridged. */
  scale?: number
}

/**
 * R5.2. A separator is (a) a component of the binarised page whose width is at least 30% of the text column and
 * whose height is at most P/4 and 25% of its width, or (b) a band of at most P/4 rows in which every row holds a
 * run of ink longer than 30% of the column, bridging gaps of 3 px (so a rule joined to the last line's letters is
 * still found). Both tests run; the one that fired is named.
 */
export function findSeparators(ink: Uint8Array, labels: Labels, o: SeparatorOpts): Separator[] {
  const { width: w, height: h } = labels
  const minW = 0.3 * o.colWidth
  const maxH = Math.floor(o.pitch / 4)
  const bridge = Math.max(2, Math.round(3 * (o.scale ?? 1)))
  const found: Separator[] = []

  // (a) components
  const bbox = new Map<number, [number, number, number, number]>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      if (id < 0) continue
      const b = bbox.get(id)
      if (!b) bbox.set(id, [x, y, x, y])
      else {
        if (x < b[0]) b[0] = x
        if (x > b[2]) b[2] = x
        if (y > b[3]) b[3] = y
      }
    }
  for (const [, b] of bbox) {
    const bw = b[2] - b[0] + 1
    const bh = b[3] - b[1] + 1
    if (bw >= minW && bh <= maxH && bh <= 0.25 * bw) found.push({ x0: b[0], x1: b[2], y0: b[1], y1: b[3], method: 'component' })
  }

  // (b) rows with one long run
  const runStart = new Int32Array(h).fill(-1)
  const runEnd = new Int32Array(h).fill(-1)
  for (let y = 0; y < h; y++) {
    let bestLen = 0
    let s = -1
    let e = -1
    let curS = -1
    let curE = -1
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue
      if (curS >= 0 && x - curE - 1 <= bridge) curE = x
      else {
        curS = x
        curE = x
      }
      if (curE - curS + 1 > bestLen) {
        bestLen = curE - curS + 1
        s = curS
        e = curE
      }
    }
    if (bestLen >= minW) (runStart[y] = s, runEnd[y] = e)
  }
  let y = 0
  while (y < h) {
    if (runStart[y]! < 0) {
      y++
      continue
    }
    let yb = y
    let x0 = runStart[y]!
    let x1 = runEnd[y]!
    let k = y + 1
    while (k < h && k <= yb + 2) {
      if (runStart[k]! >= 0) {
        yb = k
        x0 = Math.min(x0, runStart[k]!)
        x1 = Math.max(x1, runEnd[k]!)
      }
      k++
    }
    const bh = yb - y + 1
    const bw = x1 - x0 + 1
    if (bh <= maxH && bh <= 0.25 * bw) found.push({ x0, x1, y0: y, y1: yb, method: 'row-run' })
    y = yb + 1
  }

  // merge overlapping row ranges
  found.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const out: Separator[] = []
  for (const s of found) {
    const last = out[out.length - 1]
    if (last && s.y0 <= last.y1 + 1) {
      last.y1 = Math.max(last.y1, s.y1)
      last.x0 = Math.min(last.x0, s.x0)
      last.x1 = Math.max(last.x1, s.x1)
      if (last.method !== s.method) last.method = 'component+row-run'
    } else out.push({ ...s })
  }
  return out
}

export interface Block {
  /** Indices into the page lines, top to bottom. */
  lineIdx: number[]
  /** Rows available to the block: between the neighbouring separators (or the page edge). */
  yMin: number
  yMax: number
  above: Separator | null
  below: Separator | null
}

/** R5.2: cut the page's lines at separator rules; blocks without a line are dropped. */
export function findBlocks(lines: FoundLine[], seps: Separator[], height: number): Block[] {
  const cuts = [null, ...seps] as (Separator | null)[]
  const blocks: Block[] = []
  for (let i = 0; i < cuts.length; i++) {
    const above = cuts[i]!
    const below = i + 1 < cuts.length ? cuts[i + 1]! : null
    const yMin = above ? above.y1 + 1 : 0
    const yMax = below ? below.y0 - 1 : height - 1
    const idx: number[] = []
    lines.forEach((l, k) => {
      if (l.peakRow >= yMin && l.peakRow <= yMax) idx.push(k)
    })
    if (idx.length) blocks.push({ lineIdx: idx, yMin, yMax, above, below })
  }
  return blocks
}

export interface Region {
  blockIndex: number
  selectedBy: 'default' | 'curator'
  /** Half-open rows [y0, y1). */
  y0: number
  y1: number
}

/**
 * R5.3, R5.4. The block with the most lines (the first on a tie), or the `block`-th (0-based, top to bottom) when a
 * curator names one. Rows run from the block's first ink row to its last, extended by P/2 and clipped at the rules.
 * `rowInk` is the per-row ink count of the page's line-finding ink.
 */
export function chooseRegion(blocks: Block[], rowInk: Float64Array, pitch: number, block?: number): Region {
  if (blocks.length === 0) throw new Error('no block of lines found on the page')
  let bi = 0
  if (block !== undefined) {
    if (!Number.isInteger(block) || block < 0 || block >= blocks.length) throw new Error(`--block ${block} is not one of the ${blocks.length} blocks found`)
    bi = block
  } else blocks.forEach((b, i) => (b.lineIdx.length > blocks[bi]!.lineIdx.length ? (bi = i) : undefined))
  const b = blocks[bi]!
  let top = b.yMin
  while (top <= b.yMax && !rowInk[top]) top++
  let bot = b.yMax
  while (bot >= top && !rowInk[bot]) bot--
  const half = Math.round(pitch / 2)
  return {
    blockIndex: bi,
    selectedBy: block === undefined ? 'default' : 'curator',
    y0: Math.max(b.yMin, top - half),
    y1: Math.min(b.yMax + 1, bot + 1 + half),
  }
}

/** Runs of occupied columns separated by gaps of at least `minGap` empty columns. Half-open [x0, x1). */
export function columnGroups(colInk: Float64Array, minGap: number): { x0: number; x1: number; ink: number }[] {
  const groups: { x0: number; x1: number; ink: number }[] = []
  let cur: { x0: number; x1: number; ink: number } | null = null
  for (let x = 0; x < colInk.length; x++) {
    if (!colInk[x]) continue
    if (cur && x - cur.x1 < minGap) {
      cur.x1 = x + 1
      cur.ink += colInk[x]!
    } else {
      if (cur) groups.push(cur)
      cur = { x0: x, x1: x + 1, ink: colInk[x]! }
    }
  }
  if (cur) groups.push(cur)
  return groups
}

export interface Marginalia {
  box: [number, number, number, number]
  inkPx: number
}

/**
 * R5.5. Column projection of the region's rows, split at gaps of at least P/2; the group with the most ink is the
 * text column, the others are marginalia and never part of a line extent.
 */
export function findMarginalia(
  ink: Uint8Array,
  width: number,
  y0: number,
  y1: number,
  pitch: number,
): { x0: number; x1: number; marginalia: Marginalia[] } {
  const col = new Float64Array(width)
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) col[x]! += ink[y * width + x]!
  const groups = columnGroups(col, Math.max(1, Math.round(pitch / 2)))
  if (groups.length === 0) return { x0: 0, x1: width, marginalia: [] }
  let main = groups[0]!
  for (const g of groups) if (g.ink > main.ink) main = g
  const marginalia: Marginalia[] = []
  for (const g of groups) {
    if (g === main) continue
    let ya = y1
    let yb = y0
    for (let y = y0; y < y1; y++)
      for (let x = g.x0; x < g.x1; x++)
        if (ink[y * width + x]) {
          ya = Math.min(ya, y)
          yb = Math.max(yb, y)
        }
    marginalia.push({ box: [g.x0, ya, g.x1, yb + 1], inkPx: g.ink })
  }
  return { x0: main.x0, x1: main.x1, marginalia }
}
