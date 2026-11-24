// Pure layout: pane size + note metadata -> where each group is drawn.

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
  index: number
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
/** Desktop: the core band never exceeds ~1.6x its scan size. */
export const S_MAX_DESKTOP = 1.6
/** Desktop: the wider group spans this fraction of the pane width. */
export const DESKTOP_FILL = 0.675

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

function placement(
  index: number,
  meta: LayoutMeta,
  s: number,
  /** CSS position of the inked rect's top-left corner. */
  inkX: number,
  inkY: number,
): GroupPlacement {
  const g = meta.groups[index]
  const src = inflate(g.rect, meta.size)
  const dst = mapRect(src, g.rect[0], g.rect[1], inkX, inkY, s)
  const inked = mapRect(g.rect, g.rect[0], g.rect[1], inkX, inkY, s)
  return { index, src, dst, inked, scale: s, coreBandCssPx: (g.coreBand[1] - g.coreBand[0]) * s }
}

function inkedFits(p: GroupPlacement, paneW: number, paneH: number): boolean {
  const e = 1e-9
  return (
    p.inked[0] >= PAD_PX - e &&
    p.inked[1] >= PAD_PX - e &&
    p.inked[2] <= paneW - PAD_PX + e &&
    p.inked[3] <= paneH - PAD_PX + e
  )
}

export function computeLayout(kind: LayoutKind, paneW: number, paneH: number, meta: LayoutMeta): Layout {
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
      const p = placement(i, meta, s, x0, y)
      y += rectH[k] * s + GROUP_GAP_CSS
      return p
    })
    return { kind, groups, fits: groups.every((p) => inkedFits(p, paneW, paneH)) }
  }

  const scales = order.map((i) => {
    const g = meta.groups[i]
    const rectW = g.rect[2] - g.rect[0]
    let s = Math.min((paneW - 2 * PAD_PX) / rectW, S_MAX)
    let forced = false
    const band = g.coreBand[1] - g.coreBand[0]
    if (band * s < MIN_CORE_CSS_PX) {
      s = MIN_CORE_CSS_PX / band
      forced = true
    }
    return { i, s, forced }
  })
  const heights = scales.map(({ i, s }) => (meta.groups[i].rect[3] - meta.groups[i].rect[1]) * s)
  const block = heights.reduce((a, b) => a + b, 0) + GROUP_GAP_CSS * (scales.length - 1)
  let y = (paneH - block) / 2
  const groups = scales.map(({ i, s }, k) => {
    const g = meta.groups[i]
    const inkW = (g.rect[2] - g.rect[0]) * s
    const p = placement(i, meta, s, (paneW - inkW) / 2, y)
    y += heights[k] + GROUP_GAP_CSS
    return p
  })
  const fits = scales.every((x) => !x.forced) && groups.every((p) => inkedFits(p, paneW, paneH))
  return { kind, groups, fits }
}
