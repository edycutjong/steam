// Skeleton, traced path and reveal times (R22). "A path traced from the ink, left to right": it is a sort of skeleton
// pixels by sheared column, not the writer's pen order, and nothing here says otherwise.

import { labelComponents } from './components.ts'

/** Zhang-Suen thinning. Out-of-image pixels count as background. */
export function zhangSuen(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) img[i] = mask[i] ? 1 : 0
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!)
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let A = 0
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++
          if (A !== 1) continue
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          del.push(y * w + x)
        }
      if (del.length) {
        changed = true
        for (const i of del) img[i] = 0
      }
    }
  }
  return img
}

export interface GroupInput {
  /** Line index; groups are ordered by it. */
  line: number
  /** The note's owned pixels in this line, in crop coordinates (w*h, 0/1). */
  mask: Uint8Array
  /** Vertical middle of the line's core band, in crop rows. */
  yMid: number
}

export interface PathPoint {
  /** Index into `Trace.groups`. */
  group: number
  x: number
  y: number
  /** Sheared column x - s (yMid - y). */
  xp: number
  t: number
}

export interface TraceGroup {
  line: number
  yMid: number
  /** Least and greatest sheared column of the skeleton. */
  lo: number
  hi: number
  /** [t0, t1] of this group. */
  t: [number, number]
  skeletonPx: number
  /** Skeleton pixels of this group, in path order. */
  sk: { x: Int32Array; y: Int32Array; xp: Float64Array; t: Float64Array }
}

export interface Trace {
  groups: TraceGroup[]
  /** All skeleton pixels sorted by (group, x', y). */
  path: PathPoint[]
  /** Sum of group widths (hi - lo), at least 1. */
  totalWidth: number
  s: number
}

/** R22.1, R22.2. */
export function tracePath(inputs: GroupInput[], w: number, h: number, s: number): Trace {
  const ordered = [...inputs].sort((a, b) => a.line - b.line)
  const skel = ordered.map((g) => zhangSuen(g.mask, w, h))
  const raw = ordered.map((g, gi) => {
    const pts: { x: number; y: number; xp: number }[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (skel[gi]![y * w + x]) pts.push({ x, y, xp: x - s * (g.yMid - y) })
    pts.sort((a, b) => a.xp - b.xp || a.y - b.y || a.x - b.x)
    return pts
  })
  const widths = raw.map((p) => (p.length ? p[p.length - 1]!.xp - p[0]!.xp : 0))
  const total = Math.max(1, widths.reduce((a, b) => a + b, 0))
  const groups: TraceGroup[] = []
  const path: PathPoint[] = []
  let offset = 0
  raw.forEach((pts, gi) => {
    const lo = pts.length ? pts[0]!.xp : 0
    const hi = pts.length ? pts[pts.length - 1]!.xp : 0
    const sk = { x: new Int32Array(pts.length), y: new Int32Array(pts.length), xp: new Float64Array(pts.length), t: new Float64Array(pts.length) }
    pts.forEach((p, k) => {
      const t = (offset + p.xp - lo) / total
      sk.x[k] = p.x
      sk.y[k] = p.y
      sk.xp[k] = p.xp
      sk.t[k] = t
      path.push({ group: gi, x: p.x, y: p.y, xp: p.xp, t })
    })
    groups.push({ line: ordered[gi]!.line, yMid: ordered[gi]!.yMid, lo, hi, t: [offset / total, (offset + widths[gi]!) / total], skeletonPx: pts.length, sk })
    offset += widths[gi]!
  })
  return { groups, path, totalWidth: total, s }
}

/** Time of the skeleton pixel nearest to (x, y) in group `gi`; ties go to the lower x', then the lower y (R22.3). */
export function nearestTime(tr: Trace, gi: number, x: number, y: number): number {
  const g = tr.groups[gi]!
  const n = g.skeletonPx
  if (n === 0) return g.t[0]
  let best = 0
  let bd = Infinity
  for (let k = 0; k < n; k++) {
    const d = (g.sk.x[k]! - x) ** 2 + (g.sk.y[k]! - y) ** 2
    // skeleton arrays are already sorted by (x', y), so the first minimum is the tie winner
    if (d < bd) {
      bd = d
      best = k
    }
  }
  return g.sk.t[best]!
}

export interface TimeMap {
  /** Reveal time in [0, 1] per mask pixel, NaN elsewhere. */
  t: Float32Array
  /** Group index per mask pixel, -1 elsewhere. */
  group: Int16Array
}

/** R22.3: each mask pixel takes the time of its nearest skeleton pixel in its own group; skeleton-free pieces take their centroid's. */
export function timeMap(tr: Trace, inputs: GroupInput[], w: number, h: number, s: number): TimeMap {
  const ordered = [...inputs].sort((a, b) => a.line - b.line)
  const t = new Float32Array(w * h).fill(NaN)
  const group = new Int16Array(w * h).fill(-1)
  ordered.forEach((g, gi) => {
    const tg = tr.groups[gi]!
    const lab = labelComponents(g.mask, w, h)
    const pieceHasSk = new Set<number>()
    for (let k = 0; k < tg.skeletonPx; k++) pieceHasSk.add(lab.label[tg.sk.y[k]! * w + tg.sk.x[k]!]!)
    const centroid = new Map<number, number>()
    for (const id of lab.ids) if (!pieceHasSk.has(id)) centroid.set(id, 0)
    if (centroid.size) {
      const sum = new Map<number, number>()
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const id = lab.label[y * w + x]!
          if (centroid.has(id)) sum.set(id, (sum.get(id) ?? 0) + (x - s * (g.yMid - y)))
        }
      for (const id of centroid.keys()) {
        const xpc = sum.get(id)! / lab.size.get(id)!
        const raw = tg.skeletonPx ? tg.t[0] + ((xpc - tg.lo) / tr.totalWidth) : tg.t[0]
        centroid.set(id, Math.min(tg.t[1], Math.max(tg.t[0], raw)))
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!g.mask[y * w + x]) continue
        const id = lab.label[y * w + x]!
        t[y * w + x] = centroid.has(id) ? centroid.get(id)! : nearestTime(tr, gi, x, y)
        group[y * w + x] = gi
      }
  })
  return { t, group }
}
