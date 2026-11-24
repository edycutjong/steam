// Component partition: a third, code-built kind of word boundary for curator alignment (requirements R19.8 to R19.12,
// design 3.5 "Component-partition boundary"). Column runs cannot separate words whose letters overlap in a slanted
// projection; a note needs only its own edges, and the unit of this hand is the ink component.
//
// The order of a line's owned components is by slant-corrected centroid column. A boundary is an index into that
// order, chosen from the candidates (the gaps between consecutive components), never a coordinate. No component is ever
// cut: the group of a component is decided by its place in the order and by nothing else.

import type { Labels } from './components.ts'
import { MIN_COMPONENT_PX } from './constants.ts'
import { shear } from './slant.ts'

/** What alignment.json carries at the gap between two words for this kind of boundary. */
export interface ComponentBoundary {
  kind: 'component'
  after: number
}
/** One entry of `boundaryRuns`: a run index, `null` (no boundary named at this gap), or a component boundary. */
export type CuratorEntry = number | null | ComponentBoundary
export const isComponentBoundary = (e: unknown): e is ComponentBoundary => typeof e === 'object' && e !== null && (e as ComponentBoundary).kind === 'component'

export interface PartComponent {
  id: number
  /** Mean slant-corrected column x' = x - s (yMid - y) over the pixels of the component that the line owns. */
  cx: number
  /** First and last sheared column (rounded as for runs) of those pixels. */
  first: number
  last: number
  /** Pixels of the component that the line owns. */
  px: number
  /** The same, counted only when the component is writing (at least MIN_COMPONENT_PX) and the pixel's column lies inside the extent. 0 for a speck. */
  ink: number
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/**
 * The line's owned components in order: by centroid column, then by id (ids are raster indices, so a tie has one answer).
 * A component whose centroid column lies outside the text extent [lo, hi] (a margin speck) is in no word and is left out.
 */
export function lineComponents(labels: Labels, owner: Int16Array, line: number, yMid: number, s: number, extent: [number, number]): PartComponent[] {
  const W = labels.width
  const acc = new Map<number, { sum: number; n: number; first: number; last: number; ink: number }>()
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== line) continue
    const id = labels.label[i]!
    if (id < 0) continue
    const x = i % W
    const y = (i - x) / W
    const xp = shear(x, y, yMid, s)
    const col = Math.round(xp)
    let a = acc.get(id)
    if (!a) acc.set(id, (a = { sum: 0, n: 0, first: col, last: col, ink: 0 }))
    a.sum += xp
    a.n++
    if (col < a.first) a.first = col
    if (col > a.last) a.last = col
    if (col >= extent[0] && col <= extent[1]) a.ink++
  }
  const out: PartComponent[] = []
  for (const [id, a] of acc) {
    const cx = round6(a.sum / a.n)
    const c = Math.round(cx)
    if (c < extent[0] || c > extent[1]) continue
    out.push({ id, cx, first: a.first, last: a.last, px: a.n, ink: (labels.size.get(id) ?? 0) >= MIN_COMPONENT_PX ? a.ink : 0 })
  }
  out.sort((p, q) => p.cx - q.cx || p.id - q.id)
  return out
}

export interface PartCandidate {
  /** Index in the order of the component named by `after`; the gap lies between this one and the next. */
  position: number
  after: number
  before: number
  /** Empty columns between the left group and the right group (zero or more), or minus the columns they share. */
  gap: number
  /** 0 for the largest gap; ties are ranked left first. */
  rank: number
}

/**
 * R19.9: the gaps between consecutive components, ranked by the horizontal gap between the whole left group (everything up to
 * and including the component) and the whole right group. `gap >= RUN_MIN_PX` is a column run of that width.
 */
export function partitionCandidates(order: PartComponent[]): PartCandidate[] {
  const n = order.length
  if (n < 2) return []
  const prefMax = new Array<number>(n)
  const sufMin = new Array<number>(n)
  for (let i = 0; i < n; i++) prefMax[i] = Math.max(i ? prefMax[i - 1]! : -Infinity, order[i]!.last)
  for (let i = n - 1; i >= 0; i--) sufMin[i] = Math.min(i < n - 1 ? sufMin[i + 1]! : Infinity, order[i]!.first)
  const c: PartCandidate[] = []
  for (let i = 0; i < n - 1; i++) c.push({ position: i, after: order[i]!.id, before: order[i + 1]!.id, gap: sufMin[i + 1]! - prefMax[i]! - 1, rank: 0 })
  c.sort((a, b) => b.gap - a.gap || a.position - b.position)
  c.forEach((x, k) => (x.rank = k))
  return c
}

/**
 * Group number (0 for the leftmost) of every component of the order, from the ids named by the chosen boundaries, listed from
 * left to right. A component up to and including `after` is on the left of that boundary. Throws, with a message fit for
 * alignment.json, for an id that is not a candidate (not in the order, or last in it) and for ids that do not rise.
 */
export function assignGroups(order: PartComponent[], after: number[]): Map<number, number> {
  const pos = after.map((id) => {
    const p = order.findIndex((c) => c.id === id)
    if (p < 0 || p >= order.length - 1) throw new Error(`component ${id} is not a candidate (it is not a component of the line, or it is the last one)`)
    return p
  })
  for (let j = 1; j < pos.length; j++) if (pos[j]! <= pos[j - 1]!) throw new Error('component boundaries must be listed from left to right and may not repeat')
  const groups = new Map<number, number>()
  order.forEach((c, q) => groups.set(c.id, pos.filter((p) => p < q).length))
  return groups
}
