// Preservation properties: word-cut-inside-word (.kiro/specs/word-cut-inside-word/bugfix.md, "Unchanged Behavior").
// What must not change: alignment that no plausibility test objects to; the curator format without `null`; the hero note
// (whole lines) byte for byte; P1 to P6 on the real page; the P3 entries of the notes the fix does not touch.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { alignAuto, alignCurator, alignPart } from './align.ts'
import { WORD_SHAPE_RATIO_MAX } from './constants.ts'
import { charCount, cutThroughViolation, shapeViolation, wordShapes } from './plausible.ts'
import type { Run } from './runs.ts'

const runOf = (index: number, x0: number, width: number): Run => ({ index, x0, x1: x0 + width - 1, width })

/** Layout of `n` words with column widths proportional to the characters, one gap of `gap` columns between neighbours. */
const layout = (chars: number[], perChar: number, gap: number): { boundaries: number[]; extent: [number, number] } => {
  const boundaries: number[] = []
  let x = 0
  chars.forEach((c, j) => {
    x += c * perChar
    if (j < chars.length - 1) {
      boundaries.push(x + Math.floor(gap / 2))
      x += gap
    }
  })
  return { boundaries, extent: [0, x - 1] }
}
const tokensOfChars = (chars: number[]): string[] => chars.map((c) => 'a'.repeat(c))

describe('the shape test', () => {
  it('charCount: letters, digits and & count 1, other marks 0, never less than 1', () => {
    expect(['Tender,', 'sug.r', '&', 'L.', 'Quince,', '...'].map(charCount)).toEqual([6, 4, 1, 1, 6, 1])
  })

  it('accepts a line whose words are as wide as their characters predict, however the characters are spread', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 2, maxLength: 10 }), fc.integer({ min: 12, max: 40 }), (chars, perChar) => {
        const { boundaries, extent } = layout(chars, perChar, 8)
        expect(shapeViolation(boundaries, extent, tokensOfChars(chars))).toBeNull()
      }),
    )
  })

  it('rejects a cut that moves one word out of its character share by more than the factor', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 3, max: 9 }), { minLength: 3, maxLength: 10 }), fc.integer({ min: 0, max: 8 }), (chars, which) => {
        const { boundaries, extent } = layout(chars, 30, 8)
        const j = which % boundaries.length
        // pull boundary j left until word j holds under 1/factor of its share (an inside-word cut moves a boundary this way)
        const word = chars[j]! * 30
        const cut = boundaries.map((b, i) => (i === j ? b - Math.ceil(word * (1 - 1 / WORD_SHAPE_RATIO_MAX / 1.2)) : b))
        const r = shapeViolation(cut, extent, tokensOfChars(chars))
        expect(r, wordShapes(cut, extent, tokensOfChars(chars)).map((w) => w.ratio.toFixed(2)).join(' ')).not.toBeNull()
        expect(r).toMatch(/spans \d+ of \d+ columns but has \d+ of the line's \d+ characters/)
      }),
    )
  })

  it('a wrong number of boundaries is a violation, never an exception', () => {
    expect(shapeViolation([5], [0, 20], ['a', 'b', 'c'])).toMatch(/1 boundaries for 3 words/)
  })
})

describe('the cut-through test', () => {
  it('flags a boundary strictly inside a component span, not one at its edge or outside', () => {
    const spans = [{ id: 7, min: 100, max: 160 }]
    expect(cutThroughViolation([99, 100, 160, 161, 300], spans)).toBeNull()
    expect(cutThroughViolation([130], spans)).toMatch(/boundary 130 cuts component 7/)
  })
})

describe('alignment that no test objects to is unchanged', () => {
  const runsArb = fc.array(fc.integer({ min: 4, max: 40 }), { minLength: 2, maxLength: 14 }).map((ws) => {
    let x = 0
    return ws.map((w, i) => {
      const r = runOf(i, x + 10, w)
      x += 10 + w + 15
      return r
    })
  })
  it('alignAuto with a callback that finds nothing equals alignAuto without one', () => {
    fc.assert(
      fc.property(runsArb, fc.integer({ min: 2, max: 8 }), (runs, k) => {
        expect(alignAuto(runs, k, undefined, () => null)).toEqual(alignAuto(runs, k))
      }),
    )
  })
  it('alignCurator without null entries is as before, in any order of indices', () => {
    fc.assert(
      fc.property(runsArb, fc.integer({ min: 2, max: 6 }), fc.nat(), (runs, k, seed) => {
        fc.pre(runs.length >= k - 1)
        const idx = runs.slice(0, k - 1).map((r) => r.index)
        const shuffled = [...idx].sort((a, b) => ((a * 7 + seed) % 5) - ((b * 7 + seed) % 5))
        const a = alignCurator(runs, k, idx)
        const b = alignCurator(runs, k, shuffled)
        expect(a).toEqual(b)
        expect(a.ok && a.boxOfWord).toBeFalsy()
      }),
    )
  })
  it('an implausible curator candidate is refused with the reason, and the part falls to whole lines', () => {
    const runs = [runOf(0, 10, 6), runOf(1, 40, 6), runOf(2, 70, 6)]
    const r = alignCurator(runs, 3, [0, 1], undefined, () => 'word 1 "x" is too narrow')
    expect(r).toEqual({ ok: false, detail: 'alignment.json: alignment implausible: word 1 "x" is too narrow' })
    const p = alignPart({ line: 1, fromWord: 1, toWord: 1, tokenCount: 3, k: 3, runs, curator: [0, 1], implausible: () => 'too narrow' })
    expect(p.method).toBe('lines')
    expect(p.reason).toMatch(/alignment implausible: too narrow/)
  })
})

describe('null in a curator list: a gap without a run', () => {
  const runs = [runOf(0, 10, 6), runOf(1, 40, 6), runOf(2, 70, 6), runOf(3, 100, 6)]
  it('words around a null share one box; the boundaries are the named runs', () => {
    const r = alignCurator(runs, 5, [0, null, 2, 3])
    expect(r.ok && r.boundaries).toEqual([12, 72, 102])
    expect(r.ok && r.boxOfWord).toEqual([0, 1, 1, 2, 3])
  })
  it('a quote that starts or ends inside a shared box falls to whole lines; one that holds it whole is word-aligned', () => {
    const base = { line: 1, tokenCount: 5, k: 5, runs: [runOf(0, 10, 6), runOf(1, 11, 4)], curator: [0, null, 1, 0] as (number | null)[], curatorRuns: runs }
    expect(alignPart({ ...base, curator: [0, null, 2, 3], fromWord: 2, toWord: 4 }).method).toBe('lines')
    expect(alignPart({ ...base, curator: [0, null, 2, 3], fromWord: 0, toWord: 0 }).method).toBe('curator')
    const ok = alignPart({ ...base, curator: [0, null, 2, 3], fromWord: 1, toWord: 2 })
    expect(ok.method).toBe('curator')
    expect([ok.fromBox, ok.toBox]).toEqual([1, 1])
  })
  it('null entries must be listed from left to right, and the count is still k-1', () => {
    expect(alignCurator(runs, 5, [2, null, 0, 3]).ok).toBe(false)
    expect(alignCurator(runs, 5, [0, null, 2]).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// the real page
import { loadScan } from '../../tools/steam-ingest/segment.ts'
import { runGate } from './gate.ts'
import { pixelSha256 } from './image.ts'
import { sha256Hex } from './sha256.ts'
import { withoutHeroPartition } from './heroAlignment.fixture.ts'

const root = new URL('../../', import.meta.url).pathname
const dir = join(root, 'content/recipes/quinces-marmalade')
const txt = (f: string) => readFileSync(join(dir, f), 'utf8')
const before = JSON.parse(readFileSync(join(root, 'docs/kiro-evidence/word-align-speck/before-fix.json'), 'utf8')) as {
  p3: { splits: { notes: { noteId: string }[] }; reviewed: { note: string }[] }
  hero: { outputs: Record<string, string>; alignment: unknown; pageBox: number[]; pngPixelSha256: string; maskSha256: string }
}
const g = runGate({
  recipeId: 'quinces-marmalade', pageBytes: readFileSync(join(dir, 'page.jpg')), scan: loadScan(dir).scan,
  files: { 'source.json': txt('source.json'), 'lines.json': txt('lines.json'), 'fallback/reading.json': txt('fallback/reading.json'), 'ownership-review.json': txt('ownership-review.json'), 'alignment.json': withoutHeroPartition(txt('alignment.json')) },
  heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'), gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
})

describe('the real page: quinces-marmalade', () => {
  it('P1 to P6 all hold and the gate passes', () => {
    expect(g.state).toBe('pass')
    for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const) expect(g.gate.results![k].pass, `${k}: ${g.gate.results![k].detail}`).toBe(true)
  })
  it('the hero note: whole lines, mask, PNG, time-of-ink map, JSON and alignment byte-identical to the word-align-speck baseline', () => {
    const png = g.artifacts.png.get('notes/note-looks-red-smooth.png')!
    expect(pixelSha256(png)).toBe(before.hero.pngPixelSha256)
    expect(sha256Hex(Uint8Array.from(png.data.filter((_, i) => i % 4 === 3).map((v) => (v > 0 ? 1 : 0))))).toBe(before.hero.maskSha256)
    expect(Object.fromEntries(Object.entries(g.gate.outputs).filter(([k]) => k.includes('looks-red-smooth')))).toEqual(before.hero.outputs)
    expect(g.gate.alignment!.find((a) => a.noteId === 'looks-red-smooth')).toEqual(before.hero.alignment)
  })
  it('every part that a note quotes by word is a curator alignment of this author, shown as such in provenance', () => {
    const words = g.gate.alignment!.filter((a) => a.granularity === 'words')
    expect(words.map((a) => [a.noteId, a.alignment])).toEqual([['full-ripe', 'curator'], ['when-tender', 'curator']])
    for (const id of ['full-ripe', 'when-tender']) expect(JSON.parse(g.artifacts.json.get(`notes/note-${id}.json`) ? JSON.stringify(g.artifacts.json.get(`notes/note-${id}.json`)) : '{}').alignmentBy).toBe('Kiro (agent), turn-21')
  })
  it('the hero note keeps no curator marking', () => {
    expect(JSON.stringify(g.artifacts.json.get('notes/note-looks-red-smooth.json'))).not.toMatch(/alignmentBy/)
  })
})
