// Reading marks: the merged transcription writes a disagreement between the two readers as †[a|b] (a = the scribe, b = the second reader).
// Pure and total: nothing here throws.

import type { BundleNote, RecipeBundle } from './schema.ts'

export type Segment = { kind: 'text'; text: string } | { kind: 'mark'; a: string; b: string }

const MARK = /†\[([^|\]†]*)\|([^|\]†]*)\]/g

/** Splits on †[a|b]. A dagger that does not open a complete marker stays text. */
export function parseReading(line: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of line.matchAll(MARK)) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) })
    out.push({ kind: 'mark', a: m[1]!, b: m[2]! })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

/** Inverse of `parseReading`. */
export function joinReading(segs: readonly Segment[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : `†[${s.a}|${s.b}]`)).join('')
}

/** The scribe's reading: each mark becomes its `a`. */
export function primaryText(segs: readonly Segment[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : s.a)).join('')
}

/** For a screen reader: "a (the second reader reads b)", "nothing" for an empty reading. */
export function plainText(segs: readonly Segment[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : `${s.a}${s.a ? ' ' : ''}(the second reader reads ${s.b === '' ? 'nothing' : s.b})`)).join('')
}

const merge = (segs: Segment[]): Segment[] => {
  const out: Segment[] = []
  for (const s of segs) {
    const p = out[out.length - 1]
    if (s.kind === 'text' && p?.kind === 'text') out[out.length - 1] = { kind: 'text', text: p.text + s.text }
    else if (s.kind !== 'text' || s.text !== '') out.push(s)
  }
  return out
}

/**
 * The note's quoted words (`groups[].words`, inclusive, in the scribe's single-space tokens of the line's primary text),
 * with a marker kept whole when any chosen token touches it. Groups are joined by one space.
 */
export function quoteSegments(bundle: RecipeBundle, note: BundleNote): Segment[] {
  const out: Segment[] = []
  note.groups.forEach((g, gi) => {
    const line = bundle.lines.find((l) => l.i === g.line)
    if (!line) return
    const segs = parseReading(line.corrected ?? line.merged)
    // char range of each segment in the primary text
    const spans: { s: Segment; from: number; to: number }[] = []
    let pos = 0
    for (const s of segs) {
      const len = (s.kind === 'text' ? s.text : s.a).length
      spans.push({ s, from: pos, to: pos + len })
      pos += len
    }
    const primary = segs.length ? primaryText(segs) : ''
    let lo = 0
    let hi = primary.length
    if (g.words !== 'line') {
      const tokens: [number, number][] = []
      let start = 0
      for (let i = 0; i <= primary.length; i++) {
        if (i === primary.length || primary[i] === ' ') {
          tokens.push([start, i])
          start = i + 1
        }
      }
      const a = tokens[g.words.from]
      const b = tokens[g.words.to]
      if (!a || !b || g.words.to < g.words.from) return
      lo = a[0]
      hi = b[1]
    }
    if (gi > 0 && out.length) out.push({ kind: 'text', text: ' ' })
    for (const { s, from, to } of spans) {
      if (to <= lo && !(to === from && from > lo)) continue
      if (from >= hi && !(to === from && from < hi)) continue
      if (s.kind === 'mark') out.push(s)
      else out.push({ kind: 'text', text: s.text.slice(Math.max(lo, from) - from, Math.min(hi, to) - from) })
    }
  })
  return merge(out)
}
