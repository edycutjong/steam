// A synthetic recipe for gate tests: a title and four body lines drawn on paper, with readings that match the drawing.

import { canonicalJson } from './canon.ts'
import type { Rgba } from './image.ts'
import { segmentRecipe } from './segment.ts'
import { blank, mulberry32, stroke, textRow } from './synth.ts'

export const SYN_WORDS = [
  ['To', 'make'],
  ['Let', 'your', 'quinces', 'be'],
  ['full', 'ripe,', 'then', 'wipe'],
  ['boil', 'it', 'till', 'it'],
  ['Looks', 'red', '&', 'smooth,'],
]

export function syntheticScan(opts: { joined?: boolean } = {}): Rgba {
  const c = blank(800, 420)
  const rnd = mulberry32(11)
  const rows = [60, 130, 200, 270, 340]
  rows.forEach((yc, i) => textRow(c, { yc, hh: 12, x0: 90, words: SYN_WORDS[i]!.map(() => 3 + Math.floor(rnd() * 2)), gap: 26, slant: 0.25, letterW: 9 }))
  if (opts.joined) stroke(c, 150, 262, 150, 345, 3) // a stroke joining line 3 and line 4 inside the quoted words
  const scan: Rgba = { width: c.w, height: c.h, data: new Uint8Array(c.w * c.h * 4) }
  for (let i = 0; i < c.w * c.h; i++) {
    const v = c.ink[i] ? 55 + ((i * 7) % 30) : 226
    scan.data.set([v, v + 3, v - 8 < 0 ? 0 : v - 8, 255], i * 4)
  }
  return scan
}

export const SOURCE = {
  institution: 'Wellcome Collection',
  shelfmark: 'MS.1810',
  workUrl: 'https://wellcomecollection.org/works/zgtk6n7e',
  manifest: 'https://iiif.wellcomecollection.org/presentation/v2/b18419665',
  canvasIndex: 33,
  imageService: 'https://iiif.wellcomecollection.org/image/b18419665_0033.jp2',
  page: 'p.23',
  date: 'c. 1750 (IIIF manifest)',
  licence: { id: 'pdm', label: 'Public Domain Mark', url: 'https://creativecommons.org/share-your-work/public-domain/pdm/' },
  credit: 'Wellcome Collection',
  retrieved: '2026-11-25',
}

export function syntheticRecipe(opts: { joined?: boolean } = {}) {
  const scan = syntheticScan(opts)
  const sf = segmentRecipe(scan)
  const run = sf.lines.segmentRun
  const text = SYN_WORDS.map((w) => w.join(' '))
  const scribe = {
    segmentRun: run,
    title: text[0]!,
    titleLine: 0,
    lines: text.map((t, i) => ({ i, text: t })),
    steps: [
      { n: 1, lineIdx: [1, 2], text: `${text[1]} ${text[2]}` },
      { n: 2, lineIdx: [3, 4], text: `${text[3]} ${text[4]}` },
    ],
    notes: [
      { id: 'full-ripe', step: 1, span: 'full ripe,', quote: [{ line: 2, fromWord: 0, toWord: 1 }] },
      { id: 'till-smooth', step: 2, span: 'till it Looks red & smooth,', quote: [{ line: 3, fromWord: 2, toWord: 3 }, { line: 4, fromWord: 0, toWord: 3 }] },
    ],
  }
  const second = { segmentRun: run, lines: text.map((t, i) => ({ i, text: i === 1 ? 'Let your quinces bee' : t })) }
  return {
    scan,
    sf,
    files: {
      'source.json': canonicalJson(SOURCE),
      'lines.json': canonicalJson(sf.lines),
      'agent/scribe.json': canonicalJson(scribe),
      'agent/second.json': canonicalJson(second),
    } as Record<string, string>,
    scribe,
    second,
  }
}
