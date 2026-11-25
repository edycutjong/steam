// Phone gap groups (steam-renderer-v1 design §9): where a line of the note can be cut into two parts stacked one under
// the other. Pure; runs once per note from the scan's own ink columns.
import type { Rect } from './layout.ts'

/** A gap between two parts of a line: at least this many note px of columns with no ink. */
export const GAP_MIN_PX = 18
/** Ink alpha (0..255) that counts as ink when looking for a gap: hairlines included. */
export const GAP_INK_A = 24

/** One part of a cut group, in note px. `rect` is tight to the part's ink; `clip` is how far its source may reach (the cut). */
export interface SubGroup {
  rect: Rect
  coreBand: [number, number]
  t: [number, number]
  clip: [number, number]
}

export interface SplitInput {
  /** w*h ink alpha 0..255. */
  ink: ArrayLike<number>
  /** RGBA of the time-of-ink map (G = reveal time). */
  toi: ArrayLike<number>
  width: number
  height: number
  groups: ReadonlyArray<{ rect: Rect; coreBand: [number, number] }>
}

/** Interior gaps of one rect: runs of columns with no ink at least `minGap` wide, as [x0, x1) in note px. */
export function findGaps(input: Pick<SplitInput, 'ink' | 'width' | 'height'>, rect: Rect, minGap = GAP_MIN_PX): Array<[number, number]> {
  const { ink, width: w, height: h } = input
  const [x0, y0, x1, y1] = rect
  const out: Array<[number, number]> = []
  let start = -1
  let seen = false
  for (let x = x0; x < x1; x++) {
    let has = false
    for (let y = y0; y < Math.min(y1, h); y++) {
      if (ink[y * w + x] >= GAP_INK_A) {
        has = true
        break
      }
    }
    if (has) {
      if (start >= 0 && seen && x - start >= minGap) out.push([start, x])
      start = -1
      seen = true
    } else if (start < 0) start = x
  }
  return out
}

function partOf(input: SplitInput, rect: Rect, coreBand: [number, number], xa: number, xb: number, clip: [number, number]): SubGroup | null {
  const { ink, toi, width: w, height: h } = input
  const [, y0, , y1] = rect
  let minX = Infinity
  let maxX = -Infinity
  let t0 = Infinity
  let t1 = -Infinity
  for (let y = y0; y < Math.min(y1, h); y++) {
    for (let x = xa; x < xb; x++) {
      if (ink[y * w + x] < GAP_INK_A) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      const t = (toi[(y * w + x) * 4 + 1] ?? 0) / 255
      if (t < t0) t0 = t
      if (t > t1) t1 = t
    }
  }
  if (!Number.isFinite(minX)) return null
  if (!(t1 > t0)) t1 = Math.min(1, t0 + 1e-3)
  return { rect: [minX, y0, maxX + 1, y1], coreBand, t: [t0, t1], clip }
}

/**
 * Per group: the two parts cut at the gap nearest the middle of the line, or null when the line has no gap of at least
 * GAP_MIN_PX. The parts' `t` ranges come from the time-of-ink map, so the write-on head follows them.
 */
export function buildSplits(input: SplitInput): Array<[SubGroup, SubGroup] | null> {
  return input.groups.map((g) => {
    const gaps = findGaps(input, g.rect)
    if (gaps.length === 0) return null
    const mid = (g.rect[0] + g.rect[2]) / 2
    let best = gaps[0]
    for (const gap of gaps) if (Math.abs((gap[0] + gap[1]) / 2 - mid) < Math.abs((best[0] + best[1]) / 2 - mid)) best = gap
    const cut = Math.round((best[0] + best[1]) / 2)
    const left = partOf(input, g.rect, g.coreBand, g.rect[0], best[0], [0, cut])
    const right = partOf(input, g.rect, g.coreBand, best[1], g.rect[2], [cut, input.width])
    return left && right ? [left, right] : null
  })
}
