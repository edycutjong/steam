// Pure layout: pane size + note metadata -> where each group is drawn.
import type { SubGroup } from './gaps.ts'

export type Rect = [number, number, number, number]

/** The part of NoteMeta that layout needs. `NoteMeta` (assets.ts) satisfies it. */
export interface LayoutMeta {
  size: [number, number]
  groups: ReadonlyArray<{
    rect: Rect
    coreBand: [number, number]
    t: [number, number]
  }>
}

export type LayoutKind = 'page' | 'groups'

export interface GroupPlacement {
  /** Index of the note's group this placement draws (a cut group has two placements with the same index). */
  index: number
  /** Which part of a cut group this is, or 0. */
  part: number
  /** Time-of-ink range of the placed ink. */
  t: [number, number]
  /** The placed ink's rectangle in note px (a part of a cut group is narrower than the group). */
  rect: Rect
  /** Source rect in note px: group rect inflated by MARGIN_PX, clamped to the note size. */
  src: Rect
  /** Destination rect in CSS px inside the lower pane (matches `src`, scaled). */
  dst: Rect
  /** Destination of the inked rect alone (no margin), CSS px. */
  inked: Rect
  /** CSS px per note px. */
  scale: number
  /** (coreBand[1] - coreBand[0]) * scale */
  coreBandCssPx: number
}

export interface Layout {
  kind: LayoutKind
  /** Ordered by t[0]. */
  groups: GroupPlacement[]
  /** Every group's inked rect plus PAD_PX lies inside the pane. */
  fits: boolean
}

export const MARGIN_PX = 32
export const PAD_PX = 16
export const MIN_CORE_CSS_PX = 16
export const PHONE_MAX_W = 640
export const GROUP_GAP_CSS = 28
export const S_MAX = 1.25
/** Phone: cut every line at its ink gap when that makes the hand at least this much larger; smallest gap between parts and vertical pad then. */
export const GROW_MIN = 1.15
export const MIN_GAP_CSS = 14
export const PAD_V_PARTS = 8
/** Phone: the block sits this fraction of the pane height above the middle (at most). */
export const LIFT_FRAC = 0.035
/** Desktop: the core band never exceeds ~1.6x its scan size. */
export const S_MAX_DESKTOP = 1.85
/** Desktop: the wider group spans this fraction of the pane width. */
export const DESKTOP_FILL = 0.8

export function chooseLayout(paneW: number): LayoutKind {
  return paneW <= PHONE_MAX_W ? 'groups' : 'page'
}

function inflate(rect: Rect, size: [number, number]): Rect {
  return [
    Math.max(0, rect[0] - MARGIN_PX),
    Math.max(0, rect[1] - MARGIN_PX),
    Math.min(size[0], rect[2] + MARGIN_PX),
    Math.min(size[1], rect[3] + MARGIN_PX),
  ]
}

/** Map a note-px rect to CSS px given the note-px point `(ox, oy)` lands at `(dx, dy)`. */
function mapRect(r: Rect, ox: number, oy: number, dx: number, dy: number, s: number): Rect {
  return [dx + (r[0] - ox) * s, dy + (r[1] - oy) * s, dx + (r[2] - ox) * s, dy + (r[3] - oy) * s]
}

interface Placeable {
  index: number
  part: number
  rect: Rect
  coreBand: [number, number]
  t: [number, number]
  clip?: [number, number]
}

function placement(
  g: Placeable,
  meta: LayoutMeta,
  s: number,
  /** CSS position of the inked rect's top-left corner. */
  inkX: number,
  inkY: number,
): GroupPlacement {
  const src = inflate(g.rect, meta.size)
  // the source of a part never reaches past its cut, so it carries none of the other part's ink
  if (g.clip) {
    src[0] = Math.max(src[0], g.clip[0])
    src[2] = Math.min(src[2], g.clip[1])
  }
  const dst = mapRect(src, g.rect[0], g.rect[1], inkX, inkY, s)
  const inked = mapRect(g.rect, g.rect[0], g.rect[1], inkX, inkY, s)
  return { index: g.index, part: g.part, t: g.t, rect: g.rect, src, dst, inked, scale: s, coreBandCssPx: (g.coreBand[1] - g.coreBand[0]) * s }
}

function inkedFits(p: GroupPlacement, paneW: number, paneH: number, padV: number = PAD_PX): boolean {
  const e = 1e-9
  return (
    p.inked[0] >= PAD_PX - e &&
    p.inked[1] >= padV - e &&
    p.inked[2] <= paneW - PAD_PX + e &&
    p.inked[3] <= paneH - padV + e
  )
}

export function computeLayout(
  kind: LayoutKind,
  paneW: number,
  paneH: number,
  meta: LayoutMeta,
  /** Per group, the two parts it may be cut into on a phone (`buildSplits`), or null. */
  splits?: ReadonlyArray<readonly [SubGroup, SubGroup] | null>,
): Layout {
  const whole = (i: number): Placeable => ({ index: i, part: 0, rect: meta.groups[i].rect, coreBand: meta.groups[i].coreBand, t: meta.groups[i].t })
  const order = meta.groups.map((_, i) => i).sort((a, b) => meta.groups[a].t[0] - meta.groups[b].t[0])

  if (kind === 'page') {
    // Same stacked arrangement as the phone: one scale for both groups (the hand keeps one size),
    // left edges aligned, the stack centred in the pane.
    const rectW = order.map((i) => meta.groups[i].rect[2] - meta.groups[i].rect[0])
    const rectH = order.map((i) => meta.groups[i].rect[3] - meta.groups[i].rect[1])
    const wide = Math.max(...rectW)
    const stackH = rectH.reduce((a, b) => a + b, 0)
    const gaps = GROUP_GAP_CSS * (order.length - 1)
    let s = Math.min(
      (paneW * DESKTOP_FILL) / wide,
      (paneW - 2 * PAD_PX) / wide,
      (paneH - 2 * PAD_PX - gaps) / stackH,
      S_MAX_DESKTOP,
    )
    s = Math.max(1e-6, s)
    const x0 = (paneW - wide * s) / 2
    let y = (paneH - (stackH * s + gaps)) / 2
    const groups = order.map((i, k) => {
      const p = placement(whole(i), meta, s, x0, y)
      y += rectH[k] * s + GROUP_GAP_CSS
      return p
    })
    return { kind, groups, fits: groups.every((p) => inkedFits(p, paneW, paneH)) }
  }

  // Phone: every group on its own line at the largest scale that fits. A line that cannot keep the minimum core band
  // inside the pane is cut at its widest-reaching gap and its two parts are stacked at one shared scale.
  const fitW = (w: number): number => Math.min((paneW - 2 * PAD_PX) / w, S_MAX)
  const asLines = (): Array<{ parts: Placeable[]; s: number; forced: boolean }> =>
    order.map((i) => {
      const g = meta.groups[i]
      const band = g.coreBand[1] - g.coreBand[0]
      const rectW = g.rect[2] - g.rect[0]
      let s = fitW(rectW)
      let parts: Placeable[] = [whole(i)]
      const cut = splits?.[i]
      if (band * s < MIN_CORE_CSS_PX && cut) {
        parts = cut.map((p, k) => ({ index: i, part: k, rect: p.rect, coreBand: p.coreBand, t: p.t, clip: p.clip }))
        // one scale for both parts, no larger than the whole line would have had: the hand keeps one size down the pane
        s = Math.min(fitW(Math.max(...parts.map((p) => p.rect[2] - p.rect[0]))), Math.max(s, MIN_CORE_CSS_PX / band))
      }
      let forced = false
      if (band * s < MIN_CORE_CSS_PX) {
        s = MIN_CORE_CSS_PX / band
        forced = true
      }
      return { parts, s, forced }
    })
  // Use the pane (look pass 2): when every line can be cut at an ink gap, the parts stack at one larger scale. It is taken
  // when the hand grows by at least GROW_MIN and the stack still fits the glass with room to breathe.
  const asParts = (): Array<{ parts: Placeable[]; s: number; forced: boolean }> | null => {
    if (!splits || order.some((i) => !splits[i])) return null
    const lines = order.map((i) => splits[i]!.map((p, k) => ({ index: i, part: k, rect: p.rect, coreBand: p.coreBand, t: p.t, clip: p.clip }) as Placeable))
    const all = lines.flat()
    if (all.length > 4) return null
    const sumH = all.reduce((a, p) => a + (p.rect[3] - p.rect[1]), 0)
    const minGaps = MIN_GAP_CSS * (all.length - 1)
    let s = Math.min(fitW(Math.max(...all.map((p) => p.rect[2] - p.rect[0]))), (paneH - 2 * PAD_V_PARTS - minGaps) / sumH)
    if (all.some((p) => (p.coreBand[1] - p.coreBand[0]) * s < MIN_CORE_CSS_PX)) return null
    s = Math.max(1e-6, s)
    return lines.map((parts) => ({ parts, s, forced: false }))
  }
  let items = asLines()
  const grown = asParts()
  if (grown && grown[0].s >= GROW_MIN * Math.min(...items.map((x) => x.s))) items = grown
  const flat = items.flatMap((it) => it.parts.map((p) => ({ p, s: it.s })))
  const heights = flat.map(({ p, s }) => (p.rect[3] - p.rect[1]) * s)
  const padV = flat.length > 2 ? 8 : PAD_PX
  const total = heights.reduce((a, b) => a + b, 0)
  const gap = flat.length > 1 ? Math.max(6, Math.min(GROUP_GAP_CSS, (paneH - 2 * padV - total) / (flat.length - 1))) : 0
  const block = total + gap * (flat.length - 1)
  // centred slightly above the optical middle
  const lift = Math.max(0, Math.min(LIFT_FRAC * paneH, (paneH - block) / 2 - padV))
  let y = (paneH - block) / 2 - lift
  const groups = flat.map(({ p, s }, k) => {
    const inkW = (p.rect[2] - p.rect[0]) * s
    const pl = placement(p, meta, s, (paneW - inkW) / 2, y)
    y += heights[k] + gap
    return pl
  })
  const fits = items.every((x) => !x.forced) && groups.every((p) => inkedFits(p, paneW, paneH, padV))
  return { kind, groups, fits }
}
