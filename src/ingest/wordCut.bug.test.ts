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
import { cutThroughViolation, lineComponentSpans, shapeViolation, wordShapes } from './plausible.ts'
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

const parts = g.gate.alignment!.flatMap((n) => n.parts.filter((p) => p.method !== 'lines').map((p) => ({ note: n.noteId, ...p })))
const tokensOf = (line: number) => tokenise(reading.lines.find((l) => l.i === line)!.text)

describe('word-cut-inside-word on the real page: quinces-marmalade', () => {
  it('some part of the page is word-aligned (the check has something to judge)', () => {
    expect(parts.length).toBeGreaterThan(0)
  })

  it('test 1, word shape: every word of every word-aligned part is about as wide as its characters predict', () => {
    const bad: string[] = []
    for (const p of parts) {
      const reason = shapeViolation(p.boundaries, extentOf(p.line), tokensOf(p.line))
      const table = wordShapes(p.boundaries, extentOf(p.line), tokensOf(p.line)).map((w) => `${w.token}:${w.cols}c/${w.chars}ch=${w.ratio.toFixed(2)}`).join(' ')
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

  it('test 3, fixture: every eye-marked word shown by a word-aligned note has recall and precision of at least the fixture threshold', () => {
    const bad: string[] = []
    let judged = 0
    for (const r of g.gate.recall ?? []) {
      const note = g.gate.alignment!.find((n) => n.noteId === r.noteId)!
      for (const w of r.shipped.words) {
        console.log(`${r.noteId} fixture word "${w.word}": recall ${w.recall.toFixed(3)} precision ${w.precision === null ? 'n/a (whole lines)' : w.precision.toFixed(3)} (note is ${note.alignment})`)
        if (note.granularity !== 'words') continue
        judged++
        if (w.recall < r.threshold || (w.precision ?? 1) < r.threshold) bad.push(`${r.noteId} "${w.word}": recall ${w.recall.toFixed(3)}, precision ${w.precision?.toFixed(3)}, threshold ${r.threshold}`)
      }
    }
    console.log(`fixture words judged for a word-aligned note: ${judged} (the only eye-marked note is the hero, shipped as whole lines)`)
    expect(bad).toEqual([])
  })
})
