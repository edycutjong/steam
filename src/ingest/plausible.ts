// Is a word cut plausible? (bugfix word-cut-inside-word; design.md 3.5 "Plausibility of a word cut").
// Pure functions. They judge boundaries against the reading and the ink, never against the regions an alignment made.

import type { Labels } from './components.ts'
import { MIN_COMPONENT_PX, WORD_SHAPE_RATIO_MAX } from './constants.ts'
import { shearedColumn } from './runs.ts'

/**
 * Characters of a token for the shape test: each letter or digit counts 1, `&` counts 1, a raised letter counts 1 (it is a
 * letter of the token), every other mark counts 0. A token that would count 0 counts 1.
 */
export function charCount(token: string): number {
  const n = [...token].filter((c) => /[\p{L}\p{N}]/u.test(c) || c === '&').length
  return Math.max(1, n)
}

export interface WordShape {
  word: number
  token: string
  chars: number
  cols: number
  /** (w_j / E) / (c_j / C): 1 when the word is as wide as its characters predict. */
  ratio: number
}

/** Width and character share of each word of a line cut at `boundaries` inside the extent `[lo, hi]`. */
export function wordShapes(boundaries: number[], extent: [number, number], tokens: string[]): WordShape[] {
  const [lo, hi] = extent
  const E = hi - lo + 1
  const edges = [lo - 1, ...boundaries, hi]
  const chars = tokens.map(charCount)
  const C = chars.reduce((a, b) => a + b, 0)
  return tokens.map((token, j) => {
    const cols = edges[j + 1]! - edges[j]!
    return { word: j, token, chars: chars[j]!, cols, ratio: E > 0 && C > 0 ? cols / E / (chars[j]! / C) : Infinity }
  })
}

/** Test 1 (word shape): the words that are far wider or narrower than their characters predict, as a reason; null when none. */
export function shapeViolation(boundaries: number[], extent: [number, number], tokens: string[]): string | null {
  if (boundaries.length !== tokens.length - 1) return `${boundaries.length} boundaries for ${tokens.length} words`
  const E = extent[1] - extent[0] + 1
  const shapes = wordShapes(boundaries, extent, tokens)
  const C = shapes.reduce((n, w) => n + w.chars, 0)
  const bad = shapes.filter((w) => w.ratio > WORD_SHAPE_RATIO_MAX || w.ratio < 1 / WORD_SHAPE_RATIO_MAX)
  if (bad.length === 0) return null
  return bad.map((w) => `word ${w.word} "${w.token}" spans ${w.cols} of ${E} columns but has ${w.chars} of the line's ${C} characters (ratio ${w.ratio.toFixed(2)}, allowed ${1 / WORD_SHAPE_RATIO_MAX} to ${WORD_SHAPE_RATIO_MAX})`).join('; ')
}

/** Sheared column span of a component, over all its pixels whoever owns them. */
export interface ComponentSpan {
  id: number
  min: number
  max: number
}

/**
 * Column spans of the components (at least MIN_COMPONENT_PX pixels) that have at least one pixel owned by `line`.
 * Spans are over every pixel of the component, so a stroke shared with a neighbouring line shows its true width.
 */
export function lineComponentSpans(labels: Labels, owner: Int16Array, line: number, yMid: number, s: number): ComponentSpan[] {
  const W = labels.width
  const mine = new Set<number>()
  for (let i = 0; i < owner.length; i++) if (owner[i] === line && labels.label[i]! >= 0) mine.add(labels.label[i]!)
  const span = new Map<number, ComponentSpan>()
  for (let i = 0; i < labels.label.length; i++) {
    const id = labels.label[i]!
    if (id < 0 || !mine.has(id) || (labels.size.get(id) ?? 0) < MIN_COMPONENT_PX) continue
    const x = i % W
    const y = (i - x) / W
    const c = shearedColumn(x, y, yMid, s)
    const e = span.get(id)
    if (!e) span.set(id, { id, min: c, max: c })
    else {
      if (c < e.min) e.min = c
      if (c > e.max) e.max = c
    }
  }
  return [...span.values()]
}

/** Test 2 (cut-through): the boundary columns that fall strictly inside a component's column span, as a reason; null when none. */
export function cutThroughViolation(boundaries: number[], spans: ComponentSpan[]): string | null {
  const hits: string[] = []
  for (const b of boundaries) for (const c of spans) if (c.min < b && b < c.max) hits.push(`boundary ${b} cuts component ${c.id} (columns ${c.min} to ${c.max})`)
  return hits.length ? hits.join('; ') : null
}

/** Tests 1 and 2 together: the reason a candidate is implausible, or null. */
export function plausibilityViolation(boundaries: number[], extent: [number, number], tokens: string[], spans: ComponentSpan[]): string | null {
  const a = shapeViolation(boundaries, extent, tokens)
  const b = cutThroughViolation(boundaries, spans)
  const r = [a, b].filter((x): x is string => x !== null)
  return r.length ? r.join('; ') : null
}
