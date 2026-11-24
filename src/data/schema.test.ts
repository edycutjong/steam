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
