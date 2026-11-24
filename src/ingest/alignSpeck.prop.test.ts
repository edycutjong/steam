// word-align-speck preservation (.kiro/specs/word-align-speck/bugfix.md, "Unchanged Behavior").
//   U1  random lines: adding specks outside the writing changes neither the runs nor the alignment; a line with no
//       speck outside its writing gets exactly the runs it got before the fix (the all-pixel extent).
//   U2  random lines and boundaries: an accepted alignment never has a word box under the floor, and the floor only
//       ever rejects (it never turns a rejected candidate into an accepted one, nor moves a boundary).
//   U3  the real page against docs/kiro-evidence/word-align-speck/before-fix.json (recorded on the red commit's tree):
//       every line quoted by a note other than line 8 aligns exactly as before; the lines that changed are exactly
//       the measured set, each for its stated reason; the P3 review result and the hero note's whole-line mask, PNG,
//       time-of-ink map and alignment are byte-identical.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadScan } from '../../tools/steam-ingest/segment.ts'
import { alignAuto } from './align.ts'
import { WORD_INK_MIN_PX } from './constants.ts'
import { runGate } from './gate.ts'
import { pixelSha256 } from './image.ts'
import { applyReview } from './masks.ts'
import { collectLinePixels, wordInkCounts, zeroRuns, type LinePixels } from './runs.ts'
import { runsOf, segmentRecipe } from './segment.ts'
import { sha256Hex } from './sha256.ts'
import { withoutHeroPartition } from './heroAlignment.fixture.ts'

// ---------------------------------------------------------------------------------------------------------------
// U1, U2: random lines

interface Blk { x0: number; w: number; rows: number }
/** Pixels of writing blocks (big) and specks (small), sheared with s around yMid = 10. */
function linePx(blocks: Blk[], specks: [number, number][], s: number): LinePixels {
  const xs: number[] = []
  const ys: number[] = []
  const big: number[] = []
  for (const b of blocks) for (let x = b.x0; x < b.x0 + b.w; x++) for (let y = 10 - (b.rows >> 1); y < 10 - (b.rows >> 1) + b.rows; y++) (xs.push(Math.round(x - s * (10 - y))), ys.push(y), big.push(1))
  for (const [x, y] of specks) (xs.push(Math.round(x - s * (10 - y))), ys.push(y), big.push(0))
  return { xs: Int32Array.from(xs), ys: Int32Array.from(ys), big: Uint8Array.from(big) }
}
/** Writing blocks laid out left to right from x 200 with random gaps. Every block holds at least 30 px. */
const blocksArb = fc.array(fc.record({ gap: fc.integer({ min: 1, max: 30 }), w: fc.integer({ min: 3, max: 40 }), rows: fc.integer({ min: 10, max: 18 }) }), { minLength: 2, maxLength: 9 }).map((bs) => {
  let x = 200
  return bs.map((b) => {
    const blk = { x0: x, w: b.w, rows: b.rows }
    x += b.w + b.gap
    return blk
  })
})
const ext = (bs: Blk[]) => [bs[0]!.x0, bs[bs.length - 1]!.x0 + bs[bs.length - 1]!.w - 1] as const

describe('U1: specks outside the writing change nothing', () => {
  it('runs and alignment of a line with specks added in both margins equal those of the line without them', () => {
    fc.assert(
      fc.property(blocksArb, fc.array(fc.tuple(fc.integer({ min: 0, max: 150 }), fc.integer({ min: 0, max: 20 })), { minLength: 1, maxLength: 6 }), fc.integer({ min: 2, max: 9 }), fc.constantFrom(0, 0.25, 0.8), (bs, sp, k, s) => {
        const [lo, hi] = ext(bs)
        // specks left of the writing and right of it, far enough that shearing cannot bring them inside
        const specks = sp.map(([d, y], j): [number, number] => (j % 2 ? [hi + 25 + d, y] : [lo - 25 - d, y]))
        const clean = linePx(bs, [], s)
        const dirty = linePx(bs, specks, s)
        const rc = zeroRuns(clean, 10, s)
        const rd = zeroRuns(dirty, 10, s)
        expect(rd).toEqual(rc)
        const inkC = (b: number[]) => wordInkCounts(clean, 10, s, b, [rc.lo, rc.hi])
        const inkD = (b: number[]) => wordInkCounts(dirty, 10, s, b, [rd.lo, rd.hi])
        expect(alignAuto(rd.runs, k, inkD)).toEqual(alignAuto(rc.runs, k, inkC))
      }),
      { numRuns: 300 },
    )
  })
  it('a line with no speck outside its writing gets the runs of the all-pixel extent (the unfixed rule)', () => {
    fc.assert(
      fc.property(blocksArb, fc.array(fc.tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 20 })), { maxLength: 6 }), fc.constantFrom(0, 0.25, 0.8), (bs, sp, s) => {
        const [lo, hi] = ext(bs)
        // specks only strictly inside the writing's columns
        const inside = sp.map(([d, y]): [number, number] => [lo + 1 + (d % Math.max(1, hi - lo - 1)), y]).filter(([x]) => x > lo && x < hi)
        const p = linePx(bs, inside, s)
        const unfixed: LinePixels = { xs: p.xs, ys: p.ys } // no component sizes: every pixel counts, the old rule
        const a = zeroRuns(p, 10, s)
        const b = zeroRuns(unfixed, 10, s)
        // shearing can carry a speck a column past the writing's edge; then the rules differ by design
        const cols = Array.from(p.xs, (x, i) => Math.round(x - s * (10 - p.ys[i]!)))
        const wl = Math.min(...cols.filter((_, i) => p.big![i]))
        const wh = Math.max(...cols.filter((_, i) => p.big![i]))
        fc.pre(cols.every((c) => c >= wl && c <= wh))
        expect(a).toEqual(b)
      }),
      { numRuns: 300 },
    )
  })
})

describe('U2: the ink floor only rejects', () => {
  it('accepted alignments hold the floor in every word box; with the floor, a result is the same or a rejection', () => {
    fc.assert(
      fc.property(blocksArb, fc.integer({ min: 2, max: 9 }), fc.constantFrom(0, 0.25, 0.8), (bs, k, s) => {
        const p = linePx(bs, [], s)
        const r = zeroRuns(p, 10, s)
        const ink = (b: number[]) => wordInkCounts(p, 10, s, b, [r.lo, r.hi])
        const without = alignAuto(r.runs, k)
        const withFloor = alignAuto(r.runs, k, ink)
        if (withFloor.ok) {
          expect(withFloor).toEqual(without)
          for (const n of ink(withFloor.boundaries)) expect(n).toBeGreaterThanOrEqual(WORD_INK_MIN_PX)
        } else if (without.ok) {
          expect(withFloor.reason).toBe('word without ink')
          expect(Math.min(...ink(without.boundaries))).toBeLessThan(WORD_INK_MIN_PX)
        } else expect(withFloor).toEqual(without)
      }),
      { numRuns: 400 },
    )
  })
  it('word ink counts partition the writing inside the extent', () => {
    fc.assert(
      fc.property(blocksArb, fc.array(fc.integer({ min: 150, max: 900 }), { maxLength: 8 }), fc.constantFrom(0, 0.8), (bs, cuts, s) => {
        const p = linePx(bs, [], s)
        const r = zeroRuns(p, 10, s)
        const counts = wordInkCounts(p, 10, s, [...cuts].sort((a, b) => a - b), [r.lo, r.hi])
        expect(counts.length).toBe(cuts.length + 1)
        expect(counts.reduce((a, b) => a + b, 0)).toBe(p.xs.length)
      }),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// U3: the real page

interface Before {
  lines: { line: number; k: number | null; lo: number; hi: number; runs: number; auto: { ok: true; boundaries: number[] } | { ok: false; detail: string } | null }[]
  p3: unknown
  hero: { outputs: Record<string, string>; alignment: unknown; pageBox: number[]; pngPixelSha256: string; maskSha256: string }
}
const root = new URL('../../', import.meta.url).pathname
const before: Before = JSON.parse(readFileSync(join(root, 'docs/kiro-evidence/word-align-speck/before-fix.json'), 'utf8'))
const dir = join(root, 'content/recipes/quinces-marmalade')
const txt = (f: string) => readFileSync(join(dir, f), 'utf8')
const scan = loadScan(dir).scan
const seg = segmentRecipe(scan, { block: 1 }).seg
// the baseline ownership is that of the turn-18 review; the turn-21 decision (word-cut-inside-word) is applied only in the gate run below
const turn18 = (JSON.parse(txt('ownership-review.json')).decisions as Parameters<typeof applyReview>[2]).filter((d) => d.reviewer === 'Kiro (agent), turn-18')
const own = applyReview(seg.labels, seg.bands, turn18).own
const runs = runsOf(own.owner, seg.frame.width, seg.frame.height, seg.bands, seg.slant.s, seg.labels)
const lp = collectLinePixels(own.owner, seg.frame.width, seg.frame.height, seg.bands.cores.length, seg.labels)
const now = runs.map((r, i) => {
  const k = before.lines[i]!.k
  if (k === null) return null
  const a = alignAuto(r.runs, k, (b) => wordInkCounts(lp[i]!, r.yMid, seg.slant.s, b, [r.lo, r.hi]))
  return a.ok ? { ok: true as const, boundaries: a.boundaries } : { ok: false as const, detail: a.detail }
})
const g = runGate({
  recipeId: 'quinces-marmalade', pageBytes: readFileSync(join(dir, 'page.jpg')), scan,
  files: { 'source.json': txt('source.json'), 'lines.json': txt('lines.json'), 'fallback/reading.json': txt('fallback/reading.json'), 'ownership-review.json': txt('ownership-review.json'), 'alignment.json': withoutHeroPartition(txt('alignment.json')) },
  heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'), gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
})
const quoted = new Set((JSON.parse(txt('fallback/reading.json')).notes as { quote: { line: number }[] }[]).flatMap((n) => n.quote.map((q) => q.line)))

describe('U3: the real page, against the unfixed code', () => {
  it('every line quoted by a note, other than line 8, aligns exactly as before', () => {
    const others = [...quoted].filter((l) => l !== 8).sort((a, b) => a - b)
    expect(others).toEqual([1, 7, 9, 10])
    for (const l of others) expect(now[l], `line ${l}`).toEqual(before.lines[l]!.auto)
  })
  it('the lines whose alignment changed are exactly 0, 2, 4, 8 and 11, each for its measured reason', () => {
    const changed = now.flatMap((a, i) => (JSON.stringify(a) === JSON.stringify(before.lines[i]!.auto) ? [] : [i]))
    expect(changed).toEqual([0, 2, 4, 8, 11])
    // 0, 2, 4, 8: a speck outside the writing stretched the extent before the fix
    for (const l of [0, 2, 4, 8]) expect([runs[l]!.lo, runs[l]!.hi], `line ${l}`).not.toEqual([before.lines[l]!.lo, before.lines[l]!.hi])
    // 11: the unfixed code accepted a word box with no ink; the floor rejects it
    expect(now[11]).toEqual({ ok: false, detail: 'alignment rejected: word 1 holds 0 ink px, under the floor 30' })
    // 8: the speck is no longer word 0
    expect(before.lines[8]!.lo).toBe(127)
    expect(runs[8]!.lo).toBe(301)
  })
  it('lines with an unchanged extent keep their runs count and alignment, unless the floor rejects an inkless word', () => {
    for (const [i, r] of runs.entries()) {
      if (r.lo !== before.lines[i]!.lo || r.hi !== before.lines[i]!.hi) continue
      expect(r.runs.length, `line ${i}`).toBe(before.lines[i]!.runs)
      expect(now[i], `line ${i}`).toEqual(before.lines[i]!.auto)
    }
  })
  it('the P3 review result is unchanged for every note but full-ripe: result shape, counts, split shares, hero entry', () => {
    // word-cut-inside-word, on purpose: full-ripe and when-tender now quote the words that were written, not a mis-cut box.
    // full-ripe's words include a second joined stroke (the title's f, component 1661441) that needed a decision by turn-21,
    // so its reviewed count goes 1 to 2 and its share and mask size change. when-tender's mask is the fix itself.
    type Splits = { segmentSplits: number; notes: { noteId: string; maskPx: number; share: number; splitPx: number; flagged: number[] }[] }
    const nowP3 = { result: g.gate.results!.P3, ownership: g.gate.ownership, splits: g.gate.splits as Splits, reviewed: g.gate.reviewed! }
    const was = before.p3 as typeof nowP3
    expect(nowP3.result.pass).toBe(true)
    expect(nowP3.ownership).toEqual(was.ownership)
    expect(nowP3.splits.segmentSplits).toBe(was.splits.segmentSplits)
    for (const id of ['looks-red-smooth']) {
      expect(nowP3.splits.notes.find((n) => n.noteId === id)).toEqual(was.splits.notes.find((n) => n.noteId === id))
      expect(nowP3.reviewed.find((r) => r.note === id)).toEqual(was.reviewed.find((r) => r.note === id))
    }
    const wt = nowP3.splits.notes.find((n) => n.noteId === 'when-tender')!
    const wt0 = was.splits.notes.find((n) => n.noteId === 'when-tender')!
    expect([wt.share, wt.splitPx, wt.flagged]).toEqual([wt0.share, wt0.splitPx, wt0.flagged])
    const fr = nowP3.splits.notes.find((n) => n.noteId === 'full-ripe')!
    expect(fr.flagged).toEqual([1661441, 1794062])
    expect(nowP3.reviewed.find((r) => r.note === 'full-ripe')!.components).toBe(2)
  })
  it('the hero note (looks-red-smooth): whole-line mask, PNG, time-of-ink map, JSON and alignment are byte-identical', () => {
    const png = g.artifacts.png.get('notes/note-looks-red-smooth.png')!
    expect(pixelSha256(png)).toBe(before.hero.pngPixelSha256)
    expect(sha256Hex(Uint8Array.from(png.data.filter((_, i) => i % 4 === 3).map((v) => (v > 0 ? 1 : 0))))).toBe(before.hero.maskSha256)
    expect(g.checks.find((c) => c.noteId === 'looks-red-smooth')!.p4.pageBox).toEqual(before.hero.pageBox)
    expect(Object.fromEntries(Object.entries(g.gate.outputs).filter(([k]) => k.includes('looks-red-smooth')))).toEqual(before.hero.outputs)
    expect(g.gate.alignment!.find((a) => a.noteId === 'looks-red-smooth')).toEqual(before.hero.alignment)
  })
})
