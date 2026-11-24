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
  /** Set when a review decision replaced the automatic cut. */
  review?: string
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
  /** Reviewer per component decided by a review decision (R13). */
  reviewers: Map<number, string>
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
  return { width: w, height: h, owner, components: info, splits, reviewers: new Map() }
}

// ---------------------------------------------------------------------------------------------------------------
// Split share (R12)

import { SPLIT_SHARE_MAX } from './constants.ts'

export type SplitStatus = 'auto' | 'reviewed' | 'failed'

export interface NoteOwnership {
  noteId: string
  maskPx: number
  /** Mask pixels whose component was split (by the automatic rule, whether or not a decision then moved the cut). */
  splitPx: number
  /** splitPx / maskPx (0 for an empty mask). */
  share: number
  /** Split components that contribute mask pixels; the ones to look at when the share is over the threshold. */
  flagged: number[]
  /** Flagged components that carry a review decision. */
  decided: number[]
  /** Reviewers of the decided components, sorted, unique. */
  reviewers: string[]
  status: SplitStatus
}

/** R12.1: share = split pixels / mask pixels. A pixel counts when the component it belongs to was split. */
export function splitShare(own: Ownership, labels: Labels, mask: Uint8Array): { maskPx: number; splitPx: number; share: number; contributing: number[] } {
  let maskPx = 0
  let splitPx = 0
  const contrib = new Map<number, number>()
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    maskPx++
    const id = labels.label[i]!
    if (id >= 0 && own.components.get(id)?.split) {
      splitPx++
      contrib.set(id, (contrib.get(id) ?? 0) + 1)
    }
  }
  return { maskPx, splitPx, share: maskPx === 0 ? 0 : splitPx / maskPx, contributing: [...contrib.keys()].sort((a, b) => a - b) }
}

/** The one place the 0.02 comparison is made (R12.2). Exactly 0.02 passes; one pixel more fails. */
export const shareWithinThreshold = (splitPx: number, maskPx: number): boolean => maskPx === 0 || splitPx / maskPx <= SPLIT_SHARE_MAX + 1e-12

/**
 * R12.3, R12.5, R13.4. `auto`: share within the threshold. Over it, every flagged component with a decision is
 * `reviewed`, anything else is `failed`. A reviewed note is never counted as an automatic pass.
 */
export function noteOwnership(own: Ownership, labels: Labels, noteId: string, mask: Uint8Array): NoteOwnership {
  const s = splitShare(own, labels, mask)
  if (shareWithinThreshold(s.splitPx, s.maskPx)) return { noteId, maskPx: s.maskPx, splitPx: s.splitPx, share: s.share, flagged: [], decided: [], reviewers: [], status: 'auto' }
  const flagged = s.contributing
  const decided = flagged.filter((id) => own.components.get(id)!.reviewed)
  return { noteId, maskPx: s.maskPx, splitPx: s.splitPx, share: s.share, flagged, decided, reviewers: [...new Set(decided.map((id) => own.reviewers.get(id)!))].sort(), status: decided.length === flagged.length ? 'reviewed' : 'failed' }
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership review (R13)

export interface ReviewInput {
  componentId: number
  decision: { assignToLine: number } | { splitAtRow: number }
  reviewer: string
}

/** Validates decisions against the automatic ownership (R13.2); every message names the component id. */
export function validateReview(base: Ownership, bands: Bands, decisions: ReviewInput[]): string[] {
  const errs: string[] = []
  const byComp = new Map<number, ReviewInput[]>()
  for (const d of decisions) byComp.set(d.componentId, [...(byComp.get(d.componentId) ?? []), d])
  for (const [id, ds] of byComp) {
    const c = base.components.get(id)
    if (!c) {
      errs.push(`component ${id}: not an ink component of this segment run`)
      continue
    }
    const assigns = ds.filter((d) => 'assignToLine' in d.decision)
    const splits = ds.filter((d) => 'splitAtRow' in d.decision)
    if (assigns.length && splits.length) errs.push(`component ${id}: both assignToLine and splitAtRow given`)
    else if (assigns.length > 1) errs.push(`component ${id}: more than one assignToLine`)
    else if (assigns.length === 1) {
      const i = (assigns[0]!.decision as { assignToLine: number }).assignToLine
      if (!c.touched.includes(i)) errs.push(`component ${id}: line ${i} is not touched by the component (touched: ${c.touched.join(', ') || 'none'})`)
    } else {
      if (c.touched.length < 2) errs.push(`component ${id}: splitAtRow needs a component that touches two lines`)
      else if (splits.length !== c.touched.length - 1) errs.push(`component ${id}: touches ${c.touched.length} lines, needs ${c.touched.length - 1} splitAtRow entries, got ${splits.length}`)
      else {
        const rows = splits.map((d) => (d.decision as { splitAtRow: number }).splitAtRow).sort((a, b) => a - b)
        rows.forEach((y, k) => {
          const lo = bands.cores[c.touched[k]!]![1]
          const hi = bands.cores[c.touched[k + 1]!]![0]
          if (y < lo || y > hi) errs.push(`component ${id}: splitAtRow ${y} is outside [${lo}, ${hi}] between lines ${c.touched[k]} and ${c.touched[k + 1]}`)
        })
      }
    }
  }
  return errs
}

/**
 * R13.3. Decisions override the automatic owner of their own component only; every other pixel keeps its owner.
 * Returns the base ownership and the validation errors when any decision is invalid (nothing is applied then).
 */
export function applyReview(labels: Labels, bands: Bands, decisions: ReviewInput[]): { own: Ownership; errors: string[] } {
  const own = ownership(labels, bands)
  const errors = validateReview(own, bands, decisions)
  if (errors.length || decisions.length === 0) return { own, errors }
  const byComp = new Map<number, ReviewInput[]>()
  for (const d of decisions) byComp.set(d.componentId, [...(byComp.get(d.componentId) ?? []), d])
  const rule = new Map<number, (y: number) => number>()
  for (const [id, ds] of byComp) {
    const c = own.components.get(id)!
    const first = ds[0]!.decision
    let note: string
    if ('assignToLine' in first) {
      const i = first.assignToLine
      rule.set(id, () => i)
      note = `assignToLine ${i}`
    } else {
      const rows = ds.map((d) => (d.decision as { splitAtRow: number }).splitAtRow).sort((a, b) => a - b)
      const t = c.touched
      rule.set(id, (y) => {
        let k = 0
        while (k < rows.length && y >= rows[k]!) k++
        return t[k]!
      })
      note = `splitAtRow ${rows.join(',')}`
    }
    c.reviewed = true
    own.reviewers.set(id, ds[0]!.reviewer)
    const log = own.splits.find((l) => l.componentId === id)
    if (log) log.review = note
  }
  const w = labels.width
  const counts = new Map<number, number[]>()
  for (let y = 0; y < labels.height; y++)
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      const f = id >= 0 ? rule.get(id) : undefined
      if (!f) continue
      const l = f(y)
      own.owner[y * w + x] = l
      const arr = counts.get(id) ?? new Array<number>(bands.cores.length).fill(0)
      arr[l]!++
      counts.set(id, arr)
    }
  for (const log of own.splits) {
    const arr = counts.get(log.componentId)
    if (arr) log.pixelsPerLine = log.lines.map((l) => arr[l]!)
  }
  return { own, errors }
}

// ---------------------------------------------------------------------------------------------------------------
// Artifacts for a reviewer (R11)

import type { Rgba } from './image.ts'

export const LINE_TINTS: readonly (readonly [number, number, number])[] = [
  [214, 69, 65],
  [52, 152, 219],
  [39, 174, 96],
  [241, 196, 15],
  [155, 89, 182],
  [230, 126, 34],
]
export const VALLEY_MARK: readonly [number, number, number] = [255, 255, 255]
const CORE_MARK: readonly [number, number, number] = [20, 20, 20]

/** ownership/splits.json (R11.1). */
export function splitsJson(own: Ownership): (Omit<SplitLog, 'review'> & { review?: string })[] {
  return [...own.splits].sort((a, b) => a.componentId - b.componentId)
}

function dimmed(scan: Rgba): Rgba {
  const d = new Uint8Array(scan.data.length)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 127 + (scan.data[i]! >> 1)
    d[i + 1] = 127 + (scan.data[i + 1]! >> 1)
    d[i + 2] = 127 + (scan.data[i + 2]! >> 1)
    d[i + 3] = 255
  }
  return { width: scan.width, height: scan.height, data: d }
}

const put = (img: Rgba, x: number, y: number, c: readonly [number, number, number]): void => {
  const p = (y * img.width + x) * 4
  img.data[p] = c[0]
  img.data[p + 1] = c[1]
  img.data[p + 2] = c[2]
  img.data[p + 3] = 255
}

/** ownership/overlay.png (R11.2): the scan, each line's owned ink in its own tint, split rows marked white. */
export function renderOverlay(scan: Rgba, own: Ownership, labels: Labels, bands: Bands): Rgba {
  const out = dimmed(scan)
  const w = scan.width
  const valleyOf = new Set(bands.valleys)
  for (let y = 0; y < scan.height; y++)
    for (let x = 0; x < w; x++) {
      const l = own.owner[y * w + x]!
      if (l < 0) continue
      const id = labels.label[y * w + x]!
      const split = own.components.get(id)?.split
      put(out, x, y, split && valleyOf.has(y) ? VALLEY_MARK : LINE_TINTS[l % LINE_TINTS.length]!)
    }
  return out
}

/**
 * ownership/flag-<id>.png (R11.3): a crop of the scan around one component with the core band edges (dark) and the
 * valley rows (white) drawn across it, and every owned pixel of the component in the tint of its owner.
 * `rect` is [x0, y0, x1, y1] in the page frame.
 */
export function renderFlagCrop(scan: Rgba, own: Ownership, labels: Labels, bands: Bands, componentId: number, pad = 40): { image: Rgba; rect: [number, number, number, number] } {
  const c = own.components.get(componentId)
  if (!c) throw new Error(`unknown component ${componentId}`)
  const w = scan.width
  let x0 = w
  let x1 = 0
  for (let y = c.rows[0]; y <= c.rows[1]; y++)
    for (let x = 0; x < w; x++)
      if (labels.label[y * w + x] === componentId) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
  const rect: [number, number, number, number] = [Math.max(0, x0 - pad), Math.max(0, c.rows[0] - pad), Math.min(w, x1 + 1 + pad), Math.min(scan.height, c.rows[1] + 1 + pad)]
  const cw = rect[2] - rect[0]
  const ch = rect[3] - rect[1]
  const full = dimmed(scan)
  const image: Rgba = { width: cw, height: ch, data: new Uint8Array(cw * ch * 4) }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) image.data.set(full.data.subarray(((y + rect[1]) * w + x + rect[0]) * 4, ((y + rect[1]) * w + x + rect[0]) * 4 + 4), (y * cw + x) * 4)
  const hline = (row: number, col: readonly [number, number, number]): void => {
    if (row < rect[1] || row >= rect[3]) return
    for (let x = 0; x < cw; x++) put(image, x, row - rect[1], col)
  }
  for (const [a, b] of bands.cores) (hline(a, CORE_MARK), hline(b, CORE_MARK))
  for (const v of bands.valleys) hline(v, VALLEY_MARK)
  for (let y = c.rows[0]; y <= c.rows[1]; y++)
    for (let x = rect[0]; x < rect[2]; x++)
      if (labels.label[y * w + x] === componentId) put(image, x - rect[0], y - rect[1], LINE_TINTS[own.owner[y * w + x]! % LINE_TINTS.length]!)
  return { image, rect }
}
