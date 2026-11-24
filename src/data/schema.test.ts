import { describe, expect, it } from 'vitest'
import {
  Alignment,
  CheckAt,
  Fallback,
  Lines,
  OwnershipReview,
  Reading,
  Review,
  Scribe,
  SegmentRun,
  Source,
  Timing,
} from './schema.ts'

const H = 'a'.repeat(64)
const run = { id: 'sr-0123456789ab', stripsHash: H }

const reading = { segmentRun: run, lines: [{ i: 0, text: 'To make' }, { i: 1, text: 'a thing', uncertain: [{ token: 'thing', alt: ['thin'] }] }] }
const scribe = {
  ...reading,
  title: 'To make',
  titleLine: 0,
  steps: [{ n: 1, lineIdx: [1], text: 'a thing' }],
  notes: [{ id: 'n-one', step: 1, span: 'a thing', quote: [{ line: 1, fromWord: 0, toWord: 1 }] }],
}
const source = {
  institution: 'Wellcome Collection',
  shelfmark: 'MS.1810',
  workUrl: 'https://wellcomecollection.org/works/zgtk6n7e',
  manifest: 'https://iiif.wellcomecollection.org/presentation/v2/b18419665',
  canvasIndex: 33,
  imageService: 'https://iiif.wellcomecollection.org/image/b18419665_0033.jp2',
  page: 'p.23',
  date: 'c. 1750 (IIIF manifest)',
  licence: { id: 'pdm', label: 'Public Domain Mark', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
  credit: 'Wellcome Collection',
  retrieved: '2026-11-25',
}

describe('schemas: sources and runs', () => {
  it('accept valid examples', () => {
    expect(SegmentRun.safeParse(run).success).toBe(true)
    expect(Source.safeParse(source).success).toBe(true)
    expect(Source.safeParse({ ...source, frame: { width: 1601, height: 2052, scaleX: 1, scaleY: 1 } }).success).toBe(true)
  })
  it('reject a malformed run id and an unknown key', () => {
    expect(SegmentRun.safeParse({ ...run, id: 'x' }).success).toBe(false)
    expect(Source.safeParse({ ...source, extra: 1 }).success).toBe(false)
  })
})

describe('schemas: readers (R14.1, R14.7)', () => {
  it('accept a reading and a scribe file', () => {
    expect(Reading.safeParse(reading).success).toBe(true)
    expect(Scribe.safeParse(scribe).success).toBe(true)
  })
  it.each(['box', 'bbox', 'x', 'y'])('reject a reader line with a %s key', (k) => {
    const bad = { ...reading, lines: [{ i: 0, text: 'To make', [k]: [1, 2, 3, 4] }] }
    expect(Reading.safeParse(bad).success).toBe(false)
    expect(Scribe.safeParse({ ...scribe, lines: bad.lines }).success).toBe(false)
  })
  it('reject a coordinate anywhere in a scribe step or note', () => {
    expect(Scribe.safeParse({ ...scribe, notes: [{ ...scribe.notes[0], box: [1, 2, 3, 4] }] }).success).toBe(false)
    expect(Scribe.safeParse({ ...scribe, steps: [{ ...scribe.steps[0], y: 1 }] }).success).toBe(false)
  })
  it('reject uncertain tokens or text containing | or ] or the marker', () => {
    for (const token of ['a|b', 'a]', 'x†']) {
      const bad = { ...reading, lines: [{ i: 0, text: 'ok', uncertain: [{ token, alt: ['z'] }] }] }
      expect(Reading.safeParse(bad).success, token).toBe(false)
    }
    expect(Reading.safeParse({ ...reading, lines: [{ i: 0, text: 'a|b' }] }).success).toBe(false)
    expect(Reading.safeParse({ ...reading, lines: [{ i: 0, text: 'a]b' }] }).success).toBe(false)
    expect(Reading.safeParse({ ...reading, lines: [{ i: 0, text: 'alt', uncertain: [{ token: 'alt', alt: ['b|c'] }] }] }).success).toBe(false)
  })
  it('reject empty text', () => {
    expect(Reading.safeParse({ ...reading, lines: [{ i: 0, text: '' }] }).success).toBe(false)
  })
  it('accept the fallback form and require readers ["fallback"]', () => {
    const fb = { ...scribe, readers: ['fallback'], by: 'Claude Code', source: 'fixtures/gold-readings.json', sourceSha256: H }
    expect(Fallback.safeParse(fb).success).toBe(true)
    expect(Fallback.safeParse({ ...fb, readers: ['scribe', 'second'] }).success).toBe(false)
  })
})

describe('schemas: ownership review, alignment, review, timing', () => {
  const dec = { componentId: 12345, overlay: 'ownership/flag-12345.png', reviewer: 'A. Person', rationale: 'one loop of the same f' }
  it('accepts one decision key and rejects none or both', () => {
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, decision: { assignToLine: 8 } }] }).success).toBe(true)
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, decision: { splitAtRow: 1500 } }] }).success).toBe(true)
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, decision: {} }] }).success).toBe(false)
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, decision: { assignToLine: 8, splitAtRow: 1500 } }] }).success).toBe(false)
  })
  it('requires a reviewer and a rationale', () => {
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, reviewer: '', decision: { assignToLine: 1 } }] }).success).toBe(false)
    expect(OwnershipReview.safeParse({ segmentRun: run, decisions: [{ ...dec, rationale: '', decision: { assignToLine: 1 } }] }).success).toBe(false)
  })
  it('Alignment accepts run indices and rejects coordinates', () => {
    const ok = { segmentRun: run, method: 'curator', by: 'A. Person', rationale: 'gaps unclear', lines: [{ line: 8, boundaryRuns: [3, 5] }] }
    expect(Alignment.safeParse(ok).success).toBe(true)
    expect(Alignment.safeParse({ ...ok, lines: [{ line: 8, boundaryRuns: [3.5] }] }).success).toBe(false)
    expect(Alignment.safeParse({ ...ok, lines: [{ line: 8, boundaryX: [812] }] }).success).toBe(false)
    expect(Alignment.safeParse({ ...ok, lines: [{ line: 8, boundaryRuns: [-1] }] }).success).toBe(false)
  })
  it('Review needs a non-empty reviewedBy and a gate hash', () => {
    const ok = { reviewedBy: 'A. Person', reviewedAt: '2026-11-25', gateSha256: H }
    expect(Review.safeParse(ok).success).toBe(true)
    expect(Review.safeParse({ ...ok, reviewedBy: '' }).success).toBe(false)
    expect(Review.safeParse({ ...ok, gateSha256: 'abc' }).success).toBe(false)
  })
  it('CheckAt and Timing refuse negative or non-finite seconds', () => {
    expect(CheckAt.safeParse({ seconds: 0, source: 'step-entry', basis: 'b' }).success).toBe(true)
    expect(CheckAt.safeParse({ seconds: -1, source: 'cited', basis: 'b' }).success).toBe(false)
    expect(CheckAt.safeParse({ seconds: Infinity, source: 'cited', basis: 'b' }).success).toBe(false)
    expect(Timing.safeParse([{ noteId: 'n', seconds: 600, source: 'cited', basis: 'an hour' }]).success).toBe(true)
    expect(Timing.safeParse([{ noteId: 'n', seconds: 600, source: 'step-entry', basis: 'x' }]).success).toBe(false)
  })
  it('Lines validates a segment output', () => {
    const l = {
      segmentRun: run,
      frame: { width: 1601, height: 2052 },
      region: { x0: 1, y0: 2, x1: 30, y1: 40 },
      selectedBy: 'curator',
      blockIndex: 1,
      deskewDeg: 0.1,
      deskewApplied: false,
      slant: 0.3,
      marginalia: [{ box: [0, 0, 5, 5], inkPx: 40 }],
      outsideRegionInkPx: 7,
      lines: [{ i: 0, box: [1, 2, 3, 4], coreBand: [2, 3], peakRow: 2 }],
    }
    expect(Lines.safeParse(l).success).toBe(true)
    expect(Lines.safeParse({ ...l, selectedBy: 'x' }).success).toBe(false)
  })
})

import { BundleNote, Catalog, Gate, Merged, NoteJson, RecipeBundle } from './schema.ts'

describe('schemas part 2', () => {
  const ok = { pass: true, detail: 'ok' }
  const results = { P1: ok, P2: ok, P3: ok, P4: ok, P5: ok, P6: ok }
  const base = { recipeId: 'quinces-marmalade', propsVersion: '1', segmentRun: run, inputs: { page: H }, outputs: {}, at: '2026-11-25T00:00:00.000Z' }
  it('Gate accepts a waiting and a pass example', () => {
    expect(Gate.safeParse({ ...base, state: 'waiting', pass: false, waiting: ['missing: agent/scribe.json'] }).success).toBe(true)
    expect(Gate.safeParse({ ...base, state: 'pass', pass: true, results }).success).toBe(true)
  })
  it('Gate rejects pass: true with a failing property, with waiting reasons, or without results', () => {
    expect(Gate.safeParse({ ...base, state: 'pass', pass: true, results: { ...results, P3: { pass: false, detail: 'joined strokes: needs review' } } }).success).toBe(false)
    expect(Gate.safeParse({ ...base, state: 'pass', pass: true, results, waiting: ['x'] }).success).toBe(false)
    expect(Gate.safeParse({ ...base, state: 'pass', pass: true }).success).toBe(false)
    expect(Gate.safeParse({ ...base, state: 'waiting', pass: false }).success).toBe(false)
  })
  const group = { line: 8, rect: [0, 0, 10, 10], coreBand: [2, 8], t: [0, 0.5], inkPx: 50, words: { from: 6, to: 8 } }
  const note = {
    noteId: 'looks-red-smooth', step: 5, span: 'till it Looks red & smooth', shownText: 'till it Looks red & smooth', granularity: 'words', alignment: 'auto',
    source: 'Wellcome Collection', pageBox: [1, 2, 30, 40], size: [29, 38], resampled: false, groups: [group], splitShare: 0.19, splitStatus: 'reviewed',
    verifyUrl: 'https://iiif.wellcomecollection.org/image/x/pct:1,2,3,4/full/0/default.jpg', verifyApproximate: false, trace: 'a path traced from the ink, left to right',
  }
  it('NoteJson accepts a note and rejects an unknown key or a pen-order description', () => {
    expect(NoteJson.safeParse(note).success).toBe(true)
    expect(NoteJson.safeParse({ ...note, box: [1, 2, 3, 4] }).success).toBe(false)
    expect(NoteJson.safeParse({ ...note, trace: "the writer's pen order" }).success).toBe(false)
  })
  const provenance = { institution: source.institution, shelfmark: source.shelfmark, page: source.page, date: source.date, licence: source.licence, credit: source.credit }
  const { noteId: _n, source: _s, trace: _t, ...rest } = note
  void _n, void _s, void _t
  const bnote = { ...rest, id: 'looks-red-smooth', checkAt: { seconds: 0, source: 'step-entry', basis: 'the manuscript gives no time; the note arrives with its step' }, files: { png: 'a', toi: 'b', json: 'c' }, verifyBox: [1, 2, 30, 40], reveal: 'traced left to right from the ink', provenance }
  const bundle = {
    id: 'quinces-marmalade', title: 'To make Marmalade of Quinces',
    source: { ...source, canvas: { id: 'c', width: 3695, height: 4737 }, frame: { width: 1601, height: 2052, scaleX: 1, scaleY: 1 } },
    transcription: { readers: ['fallback'], by: 'x', disagreements: [], corrections: [] },
    lines: [{ i: 0, merged: 'a', primary: 'a' }], steps: [{ n: 1, lineIdx: [1], text: 'a' }], notes: [bnote], gateSha256: H,
    ownership: { autoPass: 0, reviewedPass: 1, reviewed: [{ note: 'looks-red-smooth', components: 4, reviewer: 'r' }] },
  }
  it('RecipeBundle accepts a bundle and rejects a note without provenance or checkAt, or with a cook check time', () => {
    expect(BundleNote.safeParse(bnote).error?.issues ?? []).toEqual([])
    expect(RecipeBundle.safeParse(bundle).success).toBe(true)
    const { provenance: _p, ...noProv } = bnote
    void _p
    expect(RecipeBundle.safeParse({ ...bundle, notes: [noProv] }).success).toBe(false)
    const { checkAt: _c, ...noCheck } = bnote
    void _c
    expect(RecipeBundle.safeParse({ ...bundle, notes: [noCheck] }).success).toBe(false)
    expect(RecipeBundle.safeParse({ ...bundle, notes: [{ ...bnote, checkAt: { seconds: 0, source: 'cook', basis: 'x' } }] }).success).toBe(false)
  })
  it('RecipeBundle needs source.canvas, source.frame, verifyBox and, for agent readers, review (R21.7)', () => {
    const b = bundle as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const { canvas: _c, ...noCanvas } = b.source
    const { frame: _f, ...noFrame } = b.source
    void _c, void _f
    expect(RecipeBundle.safeParse({ ...b, source: noCanvas }).success).toBe(false)
    expect(RecipeBundle.safeParse({ ...b, source: noFrame }).success).toBe(false)
    const { verifyBox: _v, ...noBox } = bnote
    void _v
    expect(RecipeBundle.safeParse({ ...b, notes: [noBox] }).success).toBe(false)
    const agents = { ...b, transcription: { ...b.transcription, readers: ['scribe', 'second-reader'], by: undefined } }
    expect(RecipeBundle.safeParse(agents).success).toBe(false)
    expect(RecipeBundle.safeParse({ ...agents, review: { reviewedBy: 'x', reviewedAt: '2026-11-25' } }).success).toBe(true)
    expect(RecipeBundle.safeParse(b).success).toBe(true) // a fallback bundle needs no review
  })
  it('CheckAt rejects negative seconds; Merged and Catalog accept their shapes', () => {
    expect(CheckAt.safeParse({ seconds: -0.5, source: 'step-entry', basis: 'x' }).success).toBe(false)
    expect(Merged.safeParse({ segmentRun: run, readers: ['fallback'], disagreements: [], readerUncertain: [], lines: [{ i: 0, merged: 'a', primary: 'a', wordCount: 1 }] }).success).toBe(true)
    expect(Catalog.safeParse([{ id: 'quinces-marmalade', title: 'T', gateSha256: H }]).success).toBe(true)
    expect(Catalog.safeParse([{ id: 'Bad Id', title: 'T', gateSha256: H }]).success).toBe(false)
  })
})
