// Bug condition exploration: word-align-speck (.kiro/specs/word-align-speck/bugfix.md), on the real page.
// Quinces p.23, the recipe as committed (fallback reader, ownership review by Kiro turn-18). Line 8's automatic word
// alignment was accepted although a speck in the left margin became word 0, so the note "when Tender" quoted a
// 1x10 px speck as "Tender," and P5 failed with "when-tender/line 8: no background". P4 cannot see it: it trusts the
// word regions. These tests state what must hold, independently of how alignment is built:
//   1. every word of every accepted (auto or curator) alignment holds at least MIN_COMPONENT_PX ink pixels of
//      components that are not specks (the pipeline's own floor for a piece of writing);
//   2. the note's line 8 part shows at least that much ink;
//   3. the gate passes P5 for when-tender.
// On the unfixed code all three fail. Output: docs/kiro-evidence/word-align-speck/red.txt
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OwnershipReview } from '../data/schema.ts'
import { loadScan } from '../../tools/steam-ingest/segment.ts'
import { assignWords } from './align.ts'
import { MIN_COMPONENT_PX } from './constants.ts'
import { runGate } from './gate.ts'
import { applyReview } from './masks.ts'
import { collectLinePixels } from './runs.ts'
import { segmentRecipe } from './segment.ts'

const root = new URL('../../', import.meta.url).pathname
const dir = join(root, 'content/recipes/quinces-marmalade')
const txt = (f: string) => readFileSync(join(dir, f), 'utf8')
const scan = loadScan(dir).scan
const g = runGate({
  recipeId: 'quinces-marmalade',
  pageBytes: readFileSync(join(dir, 'page.jpg')),
  scan,
  files: { 'source.json': txt('source.json'), 'lines.json': txt('lines.json'), 'fallback/reading.json': txt('fallback/reading.json'), 'ownership-review.json': txt('ownership-review.json') },
  heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'),
  gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
})
const seg = segmentRecipe(scan, { block: 1 }).seg
// the ownership the gate judges: the committed review applied
const decisions = OwnershipReview.parse(JSON.parse(txt('ownership-review.json'))).decisions.map((d) => ({ componentId: d.componentId, decision: d.decision, reviewer: d.reviewer }))
const own = applyReview(seg.labels, seg.bands, decisions).own
const W = seg.frame.width
const lp = collectLinePixels(own.owner, W, seg.frame.height, seg.bands.cores.length)

/** Owned ink pixels per word box of a line, counting only pixels of components that are not specks. */
function wordInk(line: number, boundaries: number[]): number[] {
  const yMid = (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2
  const word = assignWords(lp[line]!, yMid, seg.slant.s, boundaries)
  const out = new Array<number>(boundaries.length + 1).fill(0)
  for (let i = 0; i < word.length; i++) {
    const size = seg.labels.size.get(seg.labels.label[lp[line]!.ys[i]! * W + lp[line]!.xs[i]!]!)!
    if (size >= MIN_COMPONENT_PX) out[word[i]!]!++
  }
  return out
}

describe('word-align-speck on the real page: quinces-marmalade, note when-tender, line 8', () => {
  it('every word of every accepted (auto or curator) alignment holds at least the piece floor of ink', () => {
    const bad: string[] = []
    let judged = 0
    for (const note of g.gate.alignment!)
      for (const p of note.parts) {
        if (p.method === 'lines') continue
        judged++
        wordInk(p.line, p.boundaries).forEach((px, j) => {
          if (px < MIN_COMPONENT_PX) bad.push(`${note.noteId}/line ${p.line}: word ${j} holds ${px} ink px (floor ${MIN_COMPONENT_PX}); the alignment was ${p.method}: ${p.autoDetail}`)
        })
      }
    expect(judged, 'some part is word-aligned on the page').toBeGreaterThan(0)
    expect(bad).toEqual([])
  })

  it('the note when-tender shows at least the piece floor of ink from line 8, the line its second word lies on', () => {
    const c = g.checks.find((k) => k.noteId === 'when-tender')!
    const png = g.artifacts.png.get('notes/note-when-tender.png')!
    const [bx, by] = c.p4.pageBox
    let px = 0
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3] && c.p4.owner[(y + by) * W + x + bx] === 8) px++
    expect(px, `when-tender's line 8 part shows ${px} px (floor ${MIN_COMPONENT_PX})`).toBeGreaterThanOrEqual(MIN_COMPONENT_PX)
  })

  it('the gate passes P5 for when-tender', () => {
    const when = g.gate.results!.P5.detail.split(' | ').filter((s) => s.startsWith('contrast when-tender'))
    expect(when.length).toBe(1)
    expect(when[0], `P5: ${when[0]}`).not.toMatch(/no background/)
    expect(g.gate.results!.P5.pass, `P5: ${g.gate.results!.P5.detail}`).toBe(true)
  })
})
