// Bug condition exploration: word-cut-inside-word (.kiro/specs/word-cut-inside-word/bugfix.md), on the real page.
// Quinces p.23, the recipe as committed (fallback reader). Every word-aligned note part was seen to be cut inside a
// word ("e full" for "full ripe,", "n" and a blot for "when", "Tend" for "Tender,") while P1 to P6 passed, because P4
// judges the mask by the same word regions that alignment produced.
//
// The rule below is the one written into design.md 3.5 before the page was measured with it (word shape, cut-through,
// fixture). It never reads the word regions alignment made: the extent and the ink are re-derived here from the labelled
// components and the owner map, the words from the reading. The numbers are not tuned after this commit.
// On the unfixed code the shape test fails for the word-aligned parts. Output: docs/kiro-evidence/word-cut-inside-word/red.txt
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OwnershipReview } from '../data/schema.ts'
import { loadScan } from '../../tools/steam-ingest/segment.ts'
import { WORD_SHAPE_RATIO_MAX } from './constants.ts'
import { runGate } from './gate.ts'
import { applyReview } from './masks.ts'
import { tokenise } from './merge.ts'
import { assignGroups, lineComponents } from './partition.ts'
import { charCount, cutThroughViolation, lineComponentSpans, shapeViolation, wordShapes } from './plausible.ts'
import { collectLinePixels, shearedColumn } from './runs.ts'
import { segmentRecipe } from './segment.ts'

const root = new URL('../../', import.meta.url).pathname
const dir = join(root, 'content/recipes/quinces-marmalade')
const txt = (f: string) => readFileSync(join(dir, f), 'utf8')
const scan = loadScan(dir).scan
const g = runGate({
  recipeId: 'quinces-marmalade',
  pageBytes: readFileSync(join(dir, 'page.jpg')),
  scan,
  files: {
    'source.json': txt('source.json'),
    'lines.json': txt('lines.json'),
    'fallback/reading.json': txt('fallback/reading.json'),
    'ownership-review.json': txt('ownership-review.json'),
    ...(existsAlignment() ? { 'alignment.json': txt('alignment.json') } : {}),
  },
  heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'),
  gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
})
function existsAlignment(): boolean {
  try {
    readFileSync(join(dir, 'alignment.json'))
    return true
  } catch {
    return false
  }
}
const seg = segmentRecipe(scan, { block: 1 }).seg
const decisions = OwnershipReview.parse(JSON.parse(txt('ownership-review.json'))).decisions.map((d) => ({ componentId: d.componentId, decision: d.decision, reviewer: d.reviewer }))
const own = applyReview(seg.labels, seg.bands, decisions).own
const W = seg.frame.width
const s = seg.slant.s
const lp = collectLinePixels(own.owner, W, seg.frame.height, seg.bands.cores.length, seg.labels)
const reading = JSON.parse(txt('fallback/reading.json')) as { lines: { i: number; text: string }[] }
const yMidOf = (line: number) => (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2

/** The line's extent, re-derived here: first and last sheared column of its owned pixels of components of at least 30 px. */
function extentOf(line: number): [number, number] {
  const p = lp[line]!
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < p.xs.length; i++) {
    if (p.big![i] !== 1) continue
    const c = shearedColumn(p.xs[i]!, p.ys[i]!, yMidOf(line), s)
    if (c < lo) lo = c
    if (c > hi) hi = c
  }
  return [lo, hi]
}

const allParts = g.gate.alignment!.flatMap((n) => n.parts.filter((p) => p.method !== 'lines').map((p) => ({ note: n.noteId, ...p })))
// tests 1 and 2 judge boundary columns; a part cut by a component partition has none (ink share and cut-by-construction, below)
const parts = allParts.filter((p) => p.boundary !== 'component')
const componentParts = allParts.filter((p) => p.boundary === 'component')
const curatorGaps = existsAlignment() ? (JSON.parse(txt('alignment.json')).lines as { line: number; boundaryRuns: (number | null)[] }[]) : []
/** The line's words as boxes: where the curator named no run (null) the two words share one box and are judged as one. */
const tokensOf = (line: number, method?: string) => {
  const t = tokenise(reading.lines.find((l) => l.i === line)!.text)
  const gaps = method === 'curator' ? curatorGaps.find((l) => l.line === line)?.boundaryRuns : undefined
  return gaps ? t.reduce<string[]>((acc, w, j) => (j > 0 && gaps[j - 1] === null ? [...acc.slice(0, -1), `${acc[acc.length - 1]} ${w}`] : [...acc, w]), []) : t
}

describe('word-cut-inside-word on the real page: quinces-marmalade', () => {
  it('some part of the page is word-aligned (the check has something to judge)', () => {
    expect(parts.length).toBeGreaterThan(0)
  })

  it('test 1, word shape: every word of every word-aligned part is about as wide as its characters predict', () => {
    const bad: string[] = []
    for (const p of parts) {
      const reason = shapeViolation(p.boundaries, extentOf(p.line), tokensOf(p.line, p.method))
      const table = wordShapes(p.boundaries, extentOf(p.line), tokensOf(p.line, p.method)).map((w) => `${w.token}:${w.cols}c/${w.chars}ch=${w.ratio.toFixed(2)}`).join(' ')
      console.log(`${p.note}/line ${p.line} (${p.method}) ratios [limit 1/${WORD_SHAPE_RATIO_MAX}..${WORD_SHAPE_RATIO_MAX}]: ${table}`)
      if (reason) bad.push(`${p.note}/line ${p.line} (${p.method}, ${p.autoDetail}): alignment implausible: ${reason}`)
    }
    expect(bad).toEqual([])
  })

  it('test 2, cut-through: no boundary of a word-aligned part cuts a component', () => {
    const bad: string[] = []
    for (const p of parts) {
      const reason = cutThroughViolation(p.boundaries, lineComponentSpans(seg.labels, own.owner, p.line, yMidOf(p.line), s))
      console.log(`${p.note}/line ${p.line}: cut-through ${reason ?? 'none'}`)
      if (reason) bad.push(`${p.note}/line ${p.line}: ${reason}`)
    }
    expect(bad).toEqual([])
  })

  it('test 1b, component partition (design 3.5): the ink share of the quoted words is within the factor of the character share, re-derived from the labels and the owner map', () => {
    const bad: string[] = []
    const alignment = JSON.parse(txt('alignment.json')).lines as { line: number; boundaryRuns: ({ kind: string; after: number } | null)[] }[]
    for (const p of componentParts) {
      const entries = alignment.find((l) => l.line === p.line)!.boundaryRuns
      const tokens = tokenise(reading.lines.find((l) => l.i === p.line)!.text)
      const extent = extentOf(p.line)
      const order = lineComponents(seg.labels, own.owner, p.line, yMidOf(p.line), s, extent)
      const groups = assignGroups(order, entries.flatMap((e) => (e ? [e.after] : [])))
      const boxOfWord = [0]
      for (const e of entries) boxOfWord.push(boxOfWord[boxOfWord.length - 1]! + (e === null ? 0 : 1))
      const quotedGroup = boxOfWord[p.fromWord]!
      // ink: owned pixels of components of 30 px or more inside the extent, counted from the pixels, not from the order
      const inkOf = new Map<number, number>()
      for (let i = 0; i < lp[p.line]!.xs.length; i++) {
        if (lp[p.line]!.big![i] !== 1) continue
        const id = seg.labels.label[lp[p.line]!.ys[i]! * W + lp[p.line]!.xs[i]!]!
        const c = shearedColumn(lp[p.line]!.xs[i]!, lp[p.line]!.ys[i]!, yMidOf(p.line), s)
        if (c >= extent[0] && c <= extent[1] && groups.has(id)) inkOf.set(id, (inkOf.get(id) ?? 0) + 1)
      }
      let all = 0
      let quoted = 0
      for (const [id, n] of inkOf) {
        all += n
        if (groups.get(id) === quotedGroup) quoted += n
      }
      const chars = tokens.map(charCount)
      const cq = chars.slice(p.fromWord, p.toWord + 1).reduce((a, b) => a + b, 0)
      const ratio = quoted / all / (cq / chars.reduce((a, b) => a + b, 0))
      console.log(`${p.note}/line ${p.line} (component partition): ink share ${(quoted / all).toFixed(3)}, character share ${(cq / chars.reduce((a, b) => a + b, 0)).toFixed(3)}, ratio ${ratio.toFixed(2)}`)
      if (ratio > WORD_SHAPE_RATIO_MAX || ratio < 1 / WORD_SHAPE_RATIO_MAX) bad.push(`${p.note}/line ${p.line}: ratio ${ratio.toFixed(2)}`)
      // no component is cut: every pixel of a component that the line owns has the component's group, by construction of the map
      for (const id of inkOf.keys()) expect(groups.has(id)).toBe(true)
    }
    expect(bad).toEqual([])
  })

  it('test 3, fixture: every eye-marked word of a word-aligned note is reported; a note cut by words is judged per word, one cut by components by its own recall and precision (design 3.5, written before measuring)', () => {
    const bad: string[] = []
    let judged = 0
    for (const r of g.gate.recall ?? []) {
      const note = g.gate.alignment!.find((n) => n.noteId === r.noteId)!
      const byComponents = note.parts.some((p) => p.boundary === 'component')
      for (const w of r.shipped.words) {
        console.log(`${r.noteId} fixture word "${w.word}": recall ${w.recall.toFixed(3)} precision ${w.precision === null ? 'n/a (no pixel carries a word number)' : w.precision.toFixed(3)} (note is ${note.alignment}${byComponents ? ', cut by components' : ''})`)
        if (note.granularity !== 'words' || byComponents) continue
        judged++
        if (w.recall < r.threshold || (w.precision ?? 1) < r.threshold) bad.push(`${r.noteId} "${w.word}": recall ${w.recall.toFixed(3)}, precision ${w.precision?.toFixed(3)}, threshold ${r.threshold}`)
      }
      if (byComponents) {
        judged++
        console.log(`${r.noteId}: note recall ${r.shipped.recall.toFixed(4)}, precision (mask inside the fixture boxes) ${r.shipped.precision?.toFixed(4)}, threshold ${r.threshold}`)
        if (r.shipped.recall < r.threshold || (r.shipped.precision ?? 0) < r.threshold) bad.push(`${r.noteId} (components): recall ${r.shipped.recall.toFixed(3)}, precision ${r.shipped.precision?.toFixed(3)}, threshold ${r.threshold}`)
      }
    }
    console.log(`fixture notes or words judged: ${judged}`)
    expect(judged).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })
})
