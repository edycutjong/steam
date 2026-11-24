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

export function chooseLayout(paneW: number): LayoutKind {
  return paneW <= PHONE_MAX_W ? 'groups' : 'page'
}

