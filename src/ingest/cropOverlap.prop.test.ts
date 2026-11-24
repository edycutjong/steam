// crop-overlap preservation (.kiro/specs/crop-overlap/bugfix.md, "Unchanged Behavior"): the fix changes nothing but
// the crop source's default. Properties, not examples:
//   S1  for any page, any quoted lines, any word regions and any box the note arrives with, the default crop is
//       byte-identical to the ownership mask the pipeline always built (noteMask), and to P4's independent statement.
//   S2  taking the mask from the crop source changes no byte of a built note: PNG, time-of-ink PNG, note JSON.
//   S3  for random notes on the synthetic recipe the gate passes P2 and P5 for every note, and step grouping, spans
//       and quoted words come out as given.
//   S4  the gate on the recipes without boxes is byte-identical to what the unfixed code gave
//       (docs/kiro-evidence/crop-overlap/before-fix.json, recorded on the red commit's tree), and on the real
//       recipe the hero note and the other note that is not word-aligned later (full-ripe) are byte-identical.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadScan } from '../../tools/steam-ingest/segment.ts'
import { alignAuto } from './align.ts'
import { canonicalJson } from './canon.ts'
import { gateSnapshot } from './cropOverlap.fixture.ts'
import { cropSource, defaultCropMode, type CropNote, type CropPage } from './cropSource.ts'
import { labelComponents } from './components.ts'
import { runGate, type GateCtx } from './gate.ts'
import { SYN_WORDS, syntheticRecipe } from './gate.fixture.ts'
import { pixelSha256, type Gray, type Rgba } from './image.ts'
import { findLines, rowProfile } from './lines.ts'
import { noteOwnership, ownership, type Bands } from './masks.ts'
import { independentMask } from './props.ts'
import { collectLinePixels, zeroRuns } from './runs.ts'
import { blank, mulberry32, stroke, textRow, type Canvas } from './synth.ts'
import { inkMap, rawInk } from './threshold.ts'
import { buildNote, noteMask, type BuiltPart } from './timeofink.ts'

// ---------------------------------------------------------------------------------------------------------------
// S1: random pages

const W = 90
function randomPage(seed: number, n: number, strokes: number) {
  const rnd = mulberry32(seed)
  const cores: [number, number][] = []
  const valleys: number[] = []
  let y = 6 + Math.floor(rnd() * 6)
  for (let i = 0; i < n; i++) {
    const len = 6 + Math.floor(rnd() * 12)
    cores.push([y, y + len])
    y += len
    if (i + 1 < n) {
      const gap = 4 + Math.floor(rnd() * 14)
      valleys.push(y + 1 + Math.floor(rnd() * (gap - 2)))
      y += gap
    }
  }
  const H = y + 12
  const c: Canvas = blank(W, H)
  for (let i = 0; i < strokes; i++) {
    const x = Math.floor(rnd() * (W - 10))
    const yy = Math.floor(rnd() * H)
    if (rnd() < 0.5) stroke(c, x, yy, x + Math.floor(rnd() * 8 - 4), Math.min(H - 1, yy + Math.floor(rnd() * 60)), 2)
    else stroke(c, x, yy, x + Math.floor(rnd() * 40), yy + Math.floor(rnd() * 6 - 3), 2)
  }
  const bands: Bands = { cores, valleys }
  const own = ownership(labelComponents(c.ink, W, H), bands)
  return { rnd, bands, own, c, H }
}

describe('S1: the default crop is the ownership mask, whatever box the note arrives with', () => {
  const arb = fc.record({
    seed: fc.integer({ min: 1, max: 1e9 }),
    n: fc.integer({ min: 1, max: 4 }),
    strokes: fc.integer({ min: 1, max: 14 }),
    quoted: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    words: fc.boolean(),
    cuts: fc.array(fc.integer({ min: 0, max: W }), { minLength: 1, maxLength: 4 }),
    box: fc.option(fc.tuple(fc.nat(W), fc.nat(120), fc.nat(W), fc.nat(120)), { nil: undefined }),
    s: fc.constantFrom(0, 0.2, 0.8),
  })
  it('equals noteMask, equals P4\'s independent statement, and never lights a pixel of a line the note does not quote', () => {
    fc.assert(
      fc.property(arb, ({ seed, n, strokes, quoted, words, cuts, box, s }) => {
        const { bands, own, c, H } = randomPage(seed, n, strokes)
        const lines = quoted.slice(0, n).flatMap((q, i) => (q ? [i] : []))
        if (!lines.length) lines.push(0)
        const boundaries = [...cuts].sort((a, b) => a - b)
        const parts: BuiltPart[] = lines.map((line, k) => {
          const whole = !words
          const from = whole ? 0 : k % 2
          return { line, fromWord: from, toWord: whole ? 0 : Math.min(boundaries.length, from + 1 + (k % 2)), method: whole ? 'lines' : 'auto', boundaries: whole ? [] : boundaries, whole, autoDetail: '' }
        })
        const page: CropPage = { own, bands, s, ink: c.ink, tilt: 0 }
        const note: CropNote = { id: 'n', step: 1, lines, parts, ...(box ? { box: [box[0], box[1], box[0] + box[2], box[1] + box[3]] as [number, number, number, number] } : {}) }
        const crop = cropSource(page, note)
        expect(defaultCropMode(note)).toBe('ownership')
        expect(crop.mode).toBe('ownership')
        expect(Buffer.from(crop.mask).equals(Buffer.from(noteMask(own, bands, s, parts)))).toBe(true)
        const indep = independentMask({
          width: W, height: H, owner: own.owner, s,
          parts: parts.map((p) => ({ line: p.line, boundaries: p.whole ? null : p.boundaries, fromWord: p.fromWord, toWord: p.toWord, yMid: (bands.cores[p.line]![0] + bands.cores[p.line]![1]) / 2 })),
        })
        expect(Buffer.from(crop.mask).equals(Buffer.from(indep))).toBe(true)
        for (let i = 0; i < W * H; i++) if (crop.mask[i]) expect(lines).toContain(own.owner[i])
      }),
      { numRuns: 150 },
    )
  })
  it('a whole-line note shows every ink pixel its lines own, and the crop of one line is disjoint from the crop of another', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 2, max: 4 }), fc.integer({ min: 1, max: 14 }), (seed, n, strokes) => {
        const { bands, own, c, H } = randomPage(seed, n, strokes)
        const page: CropPage = { own, bands, s: 0, ink: c.ink, tilt: 0 }
        const crops = Array.from({ length: n }, (_, i) => cropSource(page, { id: `l${i}`, step: 1, lines: [i] }).mask)
        for (let p = 0; p < W * H; p++) {
          const owner = own.owner[p]!
          expect(crops.filter((m) => m[p]).length).toBe(owner >= 0 ? 1 : 0)
          if (owner >= 0) expect(crops[owner]![p]).toBe(1)
        }
      }),
      { numRuns: 80 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// S2: a built note does not change when its mask comes from the crop source

/** Three lines of four words on paper (the shape of note.test.ts). */
function pageOfWords(seed: number) {
  const c = blank(460, 330)
  const rnd = mulberry32(seed)
  for (let i = 0; i < 3; i++) textRow(c, { yc: 70 + i * 90, hh: 15, x0: 40 + Math.floor(rnd() * 12), words: [3, 4, 3, 4], gap: 18, slant: 0.2 })
  const gray: Gray = { width: c.w, height: c.h, data: new Uint8Array(c.w * c.h) }
  const scan: Rgba = { width: c.w, height: c.h, data: new Uint8Array(c.w * c.h * 4) }
  for (let i = 0; i < c.w * c.h; i++) {
    const v = c.ink[i] ? 55 + ((i % c.w) * 13) % 40 : 225
    gray.data[i] = v
    scan.data.set([v, Math.min(255, v + 4), Math.max(0, v - 6), 255], i * 4)
  }
  const ink = inkMap(gray)
  const labels = labelComponents(ink, c.w, c.h)
  const found = findLines(rowProfile(ink, c.w, c.h))
  const bands: Bands = { cores: found.lines.map((l) => l.core), valleys: found.valleys }
  return { c, gray, scan, ink, labels, bands, own: ownership(labels, bands), raw: rawInk(gray) }
}

describe('S2: buildNote with the crop source\'s mask is byte-identical to buildNote building its own', () => {
  it('for random lines and word runs: PNG, time-of-ink PNG and note JSON', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), fc.boolean(), (seed, line, a, b, whole) => {
        const p = pageOfWords(seed)
        const s = 0.2
        const lp = collectLinePixels(p.own.owner, p.c.w, p.c.h, p.bands.cores.length)
        const yMid = (p.bands.cores[line]![0] + p.bands.cores[line]![1]) / 2
        const al = alignAuto(zeroRuns(lp[line]!, yMid, s).runs, line === 0 ? 3 : 4)
        const k = line === 0 ? 3 : 4
        // not every synthetic line aligns by words: those fall back to whole lines, as the gate does
        const from = Math.min(a, b, k - 1)
        const to = Math.min(Math.max(a, b), k - 1)
        const useWhole = whole || !al.ok
        const part: BuiltPart = { line, fromWord: from, toWord: to, method: useWhole ? 'lines' : 'auto', boundaries: al.ok ? al.boundaries : [], whole: useWhole, autoDetail: '' }
        const page: CropPage = { own: p.own, bands: p.bands, s, ink: p.ink, tilt: 0 }
        const mask = cropSource(page, { id: 'n', step: 1, lines: [line], parts: [part] }).mask
        const base = {
          noteId: 'n', step: 1, span: 'x', shownText: 'x', granularity: 'words' as const, alignment: 'auto' as const, credit: 'Wellcome Collection',
          scan: p.scan, gray: p.gray, raw: p.raw, pageInk: p.ink, own: p.own, bands: p.bands, s, resampled: false, parts: [part],
          ownership: noteOwnership(p.own, p.labels, 'n', noteMask(p.own, p.bands, s, [part])),
        }
        const old = buildNote(base)
        const fixed = buildNote({ ...base, mask })
        expect(pixelSha256(fixed.png)).toBe(pixelSha256(old.png))
        expect(pixelSha256(fixed.toi)).toBe(pixelSha256(old.toi))
        expect(canonicalJson(fixed.core)).toBe(canonicalJson(old.core))
        expect(fixed.pageBox).toEqual(old.pageBox)
        expect(Buffer.from(fixed.mask).equals(Buffer.from(old.mask))).toBe(true)
      }),
      { numRuns: 60 },
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------
// S3 and S4: the gate

const rec = syntheticRecipe()
const ctxOf = (files: Record<string, string>, scan = rec.scan): GateCtx => ({ recipeId: 'syn', pageBytes: new Uint8Array([1, 2, 3]), scan, files: files as unknown as GateCtx['files'] })

describe('S3: P2 and P5 hold for every note, and steps and spans come out as given', () => {
  // lines 1..4 of the synthetic recipe hold four words each; step 1 = lines 1,2; step 2 = lines 3,4
  const quote = fc
    .record({ step: fc.constantFrom(1, 2), cross: fc.boolean(), from: fc.integer({ min: 0, max: 3 }), to: fc.integer({ min: 0, max: 3 }) })
    .map(({ step, cross, from, to }) => {
      const a = step === 1 ? 1 : 3
      if (!cross) return { step, quote: [{ line: a, fromWord: Math.min(from, to), toWord: Math.max(from, to) }] }
      return { step, quote: [{ line: a, fromWord: from, toWord: 3 }, { line: a + 1, fromWord: 0, toWord: to }] }
    })
  it('for random one-line and two-line quotes', () => {
    fc.assert(
      fc.property(fc.array(quote, { minLength: 1, maxLength: 2 }), (qs) => {
        const scribe = structuredClone(rec.scribe)
        // second reader agrees: no disagreement atoms to split
        const second = { ...rec.second, lines: rec.scribe.lines.map((l) => ({ ...l })) }
        scribe.notes = qs.map((q, i) => {
          const words = q.quote.flatMap((p) => SYN_WORDS[p.line]!.slice(p.fromWord, p.toWord + 1))
          return { id: `n${i}`, step: q.step, span: words.join(' ').replace(/[,.;:]+$/, ''), quote: q.quote }
        })
        const g = runGate(ctxOf({ ...rec.files, 'agent/scribe.json': canonicalJson(scribe), 'agent/second.json': canonicalJson(second) }))
        expect(g.state, g.firstFailure).toBe('pass')
        expect(g.gate.results!.P2.pass).toBe(true)
        expect(g.gate.results!.P5.pass).toBe(true)
        const steps = (g.artifacts.json.get('merged.json') as { lines: unknown[] }).lines.length
        expect(steps).toBe(SYN_WORDS.length)
        for (const [i, q] of qs.entries()) {
          const nj = g.artifacts.json.get(`notes/note-n${i}.json`) as { step: number; span: string }
          expect(nj.step).toBe(q.step)
          expect(nj.span).toBe(scribe.notes[i]!.span)
          const al = g.gate.alignment!.find((x) => x.noteId === `n${i}`)!
          expect(al.parts.map((p) => [p.line, p.fromWord, p.toWord])).toEqual(q.quote.map((p) => [p.line, p.fromWord, p.toWord]))
        }
      }),
      { numRuns: 25 },
    )
  })
})

interface Frozen {
  synthetic: ReturnType<typeof gateSnapshot>
  'synthetic-joined': ReturnType<typeof gateSnapshot>
  real: {
    state: string
    pass: boolean
    results: Record<string, { pass: boolean; detail: string }>
    outputs: Record<string, string>
    alignment: { noteId: string }[]
    recall: { noteId: string }[]
    mergedJsonSha256: string
  }
}
const frozen: Frozen = JSON.parse(readFileSync(new URL('../../docs/kiro-evidence/crop-overlap/before-fix.json', import.meta.url), 'utf8'))

describe('S4: the gate result without eye-read boxes is what the unfixed code gave', () => {
  for (const [name, joined] of [['synthetic', false], ['synthetic-joined', true]] as const) {
    it(`${name}: gate.json content, every PNG pixel and every JSON byte are identical`, () => {
      const r = syntheticRecipe({ joined })
      const now = gateSnapshot(runGate(ctxOf(r.files, r.scan)))
      expect(now).toEqual(frozen[name])
    })
  }

  const root = new URL('../../', import.meta.url).pathname
  const dir = join(root, 'content/recipes/quinces-marmalade')
  const txt = (f: string) => readFileSync(join(dir, f), 'utf8')
  const real = runGate({
    recipeId: 'quinces-marmalade',
    pageBytes: readFileSync(join(dir, 'page.jpg')),
    scan: loadScan(dir).scan,
    files: {
      'source.json': txt('source.json'), 'lines.json': txt('lines.json'), 'fallback/reading.json': txt('fallback/reading.json'), 'ownership-review.json': txt('ownership-review.json'),
    },
    heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'),
    gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
  })
  const mergedNow = canonicalJson(real.artifacts.json.get('merged.json'))
  // The notes compared in full. when-tender is the note whose automatic word alignment the later word-align-speck
  // bugfix changes on purpose (its P5 failed before this fix, for a different reason), so its bytes are not frozen here.
  const FROZEN_NOTES = ['full-ripe', 'looks-red-smooth']

  it('real recipe: step grouping and note spans (merged.json) are byte-identical', () => {
    const buf = new TextEncoder().encode(mergedNow)
    return crypto.subtle.digest('SHA-256', buf).then((h) => {
      const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
      expect(hex).toBe(frozen.real.mergedJsonSha256)
    })
  })
  it('real recipe: P1 to P4 and P6 verdicts are those of the unfixed code (P5 is judged per note below)', () => {
    expect(real.state).toBe(frozen.real.state)
    for (const k of ['P1', 'P2', 'P3', 'P4', 'P6'] as const) expect(real.gate.results![k].pass, k).toBe(frozen.real.results[k]!.pass)
  })
  for (const id of FROZEN_NOTES) {
    it(`real recipe, note ${id}: PNG, time-of-ink map (the hero's mask is unchanged), JSON, alignment and recall are identical`, () => {
      for (const ext of ['json', 'png', 'toi.png']) expect(real.gate.outputs[`notes/note-${id}.${ext}`], ext).toBe(frozen.real.outputs[`notes/note-${id}.${ext}`])
      expect(real.gate.alignment!.find((a) => a.noteId === id)).toEqual(frozen.real.alignment.find((a) => a.noteId === id))
      expect(real.gate.recall?.find((a) => a.noteId === id)).toEqual(frozen.real.recall?.find((a) => a.noteId === id))
      // P2 and P5 for this note: the detail text of the unfixed run, note by note
      const seg = (r: { detail: string }) => r.detail.split(' | ').filter((s) => s.startsWith(`contrast ${id}:`))
      expect(seg(real.gate.results!.P5)).toEqual(seg(frozen.real.results.P5!))
      expect(seg(real.gate.results!.P5).length).toBe(1)
    })
  }
})
