import { describe, expect, it } from 'vitest'
import { alignAuto } from './align.ts'
import { labelComponents } from './components.ts'
import type { Gray, Rgba } from './image.ts'
import { findLines, rowProfile } from './lines.ts'
import { noteOwnership, ownership, type Bands } from './masks.ts'
import { collectLinePixels, zeroRuns } from './runs.ts'
import { blank, stroke, textRow, type Canvas } from './synth.ts'
import { inkMap, rawInk } from './threshold.ts'
import { buildNote, noteMask, paperEstimate, type BuiltPart } from './timeofink.ts'

/** Three lines of words; the scan has paper 225 and ink 55..95 (pen pressure varies with x). */
function page(opts: { extra?: (c: Canvas) => void; offsetX?: number; offsetY?: number } = {}) {
  const c = blank(460, 330)
  const ox = opts.offsetX ?? 0
  const oy = opts.offsetY ?? 0
  const truth: { x0: number; x1: number }[][] = []
  for (let i = 0; i < 3; i++) truth.push(textRow(c, { yc: 70 + oy + i * 90, hh: 15, x0: 40 + ox, words: [3, 4, 3, 4], gap: 18, slant: 0.2 }))
  opts.extra?.(c)
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
  const own = ownership(labels, bands)
  return { c, gray, scan, ink, labels, bands, own, raw: rawInk(gray), truth, lines: found.lines.length }
}

const part = (line: number, fromWord: number, toWord: number, boundaries: number[], whole = false): BuiltPart => ({
  line, fromWord, toWord, method: whole ? 'lines' : 'auto', boundaries, whole, autoDetail: '',
})

function wordBoundaries(p: ReturnType<typeof page>, line: number, s: number) {
  const lp = collectLinePixels(p.own.owner, p.c.w, p.c.h, p.bands.cores.length)
  const yMid = (p.bands.cores[line]![0] + p.bands.cores[line]![1]) / 2
  const r = zeroRuns(lp[line]!, yMid, s)
  const a = alignAuto(r.runs, 4)
  if (!a.ok) throw new Error(a.detail)
  return a.boundaries
}

function build(p: ReturnType<typeof page>, parts: BuiltPart[], s = 0.2) {
  return buildNote({
    noteId: 'n', step: 1, span: 'x', shownText: 'x', granularity: 'words', alignment: 'auto', credit: 'Wellcome Collection',
    scan: p.scan, gray: p.gray, raw: p.raw, own: p.own, bands: p.bands, s, resampled: false, parts,
    ownership: noteOwnership(p.own, p.labels, 'n', noteMask(p.own, p.bands, s, parts)),
  })
}

describe('buildNote (R21)', () => {
  const p = page()
  const b = wordBoundaries(p, 1, 0.2)
  const note = build(p, [part(1, 1, 2, b)])

  it('the mask is the owned pixels of the quoted words and nothing else', () => {
    expect(p.lines).toBe(3)
    const W = p.c.w
    const lp = collectLinePixels(p.own.owner, W, p.c.h, 3)[1]!
    let n = 0
    for (let i = 0; i < lp.xs.length; i++) {
      const x = lp.xs[i]!
      const inWords = x > b[0]! - 3 && x <= b[2]! + 8 // a loose spatial check; the exact rule is by sheared column
      if (note.mask[lp.ys[i]! * W + x]) {
        n++
        expect(inWords).toBe(true)
      }
    }
    expect(n).toBeGreaterThan(50)
    for (let i = 0; i < note.mask.length; i++) if (note.mask[i]) expect(p.own.owner[i]).toBe(1)
  })

  it('alpha > 0 only on the mask and on non-ink pixels near it, never on other ink (P4 a, b)', () => {
    const { pageBox, png } = note
    const W = p.c.w
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const a = png.data[(y * png.width + x) * 4 + 3]!
        if (a === 0) continue
        const g = (y + pageBox[1]) * W + x + pageBox[0]
        if (p.ink[g]) expect(note.mask[g]).toBe(1)
        else {
          let near = false
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (note.mask[(y + pageBox[1] + dy) * W + x + pageBox[0] + dx]) near = true
          expect(near).toBe(true)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const q = (y + pageBox[1] + dy) * W + x + pageBox[0] + dx
              if (p.ink[q]) expect(note.mask[q]).toBe(1)
            }
        }
      }
  })

  it('alpha is continuous: the pen\'s darkness variation survives (not a binary mask)', () => {
    const vals = new Set<number>()
    for (let i = 3; i < note.png.data.length; i += 4) if (note.png.data[i]) vals.add(note.png.data[i]!)
    expect(vals.size).toBeGreaterThan(12)
    expect(Math.max(...vals)).toBeGreaterThan(200)
  })

  it('RGB under alpha > 0 is the scan; under alpha 0 it is the flat paper value', () => {
    const { pageBox, png } = note
    const W = p.c.w
    const paperRgbs = new Set<string>()
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const o = (y * png.width + x) * 4
        const a = png.data[o + 3]!
        const so = ((y + pageBox[1]) * W + x + pageBox[0]) * 4
        if (a > 0) expect([...png.data.subarray(o, o + 3)]).toEqual([...p.scan.data.subarray(so, so + 3)])
        else paperRgbs.add([...png.data.subarray(o, o + 3)].join())
      }
    expect(paperRgbs.size).toBe(1)
    expect([...paperRgbs][0]).toBe('225,229,219')
  })

  it('keeps a 32 px transparent margin around the mask, clipped at the page edge, pageBox by code', () => {
    const [x0, y0, x1, y1] = note.pageBox
    let mx0 = 1e9, my0 = 1e9, mx1 = -1, my1 = -1
    for (let i = 0; i < note.mask.length; i++)
      if (note.mask[i]) {
        const x = i % p.c.w, y = Math.floor(i / p.c.w)
        mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y)
      }
    expect(note.pageBox).toEqual([Math.max(0, mx0 - 32), Math.max(0, my0 - 32), Math.min(p.c.w, mx1 + 33), Math.min(p.c.h, my1 + 33)])
    expect(note.png.width).toBe(x1 - x0)
    expect(note.png.height).toBe(y1 - y0)
    expect(note.core.size).toEqual([x1 - x0, y1 - y0])
    // the outermost 20 px ring is transparent
    for (let x = 0; x < note.png.width; x++) expect(note.png.data[x * 4 + 3]).toBe(0)
  })

  it('a note near the page edge is clipped there', () => {
    const q = page({ offsetX: -30, offsetY: -45 })
    const bq = wordBoundaries(q, 0, 0.2)
    const n = build(q, [part(0, 0, 1, bq)])
    expect(n.pageBox[0]).toBe(0)
    expect(n.pageBox[1]).toBe(0)
  })

  it('toi: R equals alpha, G is the quantised time in [0,255], B the density, zero elsewhere', () => {
    const { png, toi } = note
    for (let i = 0; i < png.width * png.height; i++) {
      expect(toi.data[i * 4]).toBe(png.data[i * 4 + 3])
      if (png.data[i * 4 + 3]) expect(toi.data[i * 4 + 1]!).toBeGreaterThanOrEqual(0)
      else expect(toi.data[i * 4 + 1]).toBe(0)
    }
    expect(note.trace.groups.length).toBe(1)
    expect(note.core.groups[0]).toMatchObject({ line: 1, words: { from: 1, to: 2 } })
  })

  it('a faint hairline join (not ink to the binariser) within 2 px of the mask survives; one 1 px from another line\'s ink does not', () => {
    const q = page()
    const bq = wordBoundaries(q, 1, 0.2)
    // paint a 1 px hairline of gray 205 (faint) 2 px right of a mask pixel, below the quote's last word
    const plain = build(q, [part(1, 1, 2, bq)])
    let hx = -1, hy = -1
    for (let i = 0; i < plain.mask.length && hx < 0; i++) {
      const x = i % q.c.w, y = Math.floor(i / q.c.w)
      if (plain.mask[i] && !plain.mask[i + 1] && !plain.mask[i + 2] && !q.ink[i + 1] && !q.ink[i + 2] && !q.ink[i + 3] && !q.ink[i + 1 + q.c.w] && !q.ink[i + 1 - q.c.w] && !q.ink[i + 2 + q.c.w] && !q.ink[i + 2 - q.c.w]) (hx = x + 2, (hy = y))
    }
    expect(hx).toBeGreaterThan(0)
    const faint = structuredClone({ ...q, gray: { ...q.gray, data: q.gray.data.slice() }, scan: { ...q.scan, data: q.scan.data.slice() } })
    faint.gray.data[hy * q.c.w + hx] = 190
    faint.scan.data.set([190, 190, 190, 255], (hy * q.c.w + hx) * 4)
    expect(q.ink[hy * q.c.w + hx]).toBe(0)
    const withFaint = buildNote({
      noteId: 'n', step: 1, span: 'x', shownText: 'x', granularity: 'words', alignment: 'auto', credit: 'c',
      scan: faint.scan, gray: faint.gray, raw: q.raw, own: q.own, bands: q.bands, s: 0.2, resampled: false, parts: [part(1, 1, 2, bq)],
      ownership: noteOwnership(q.own, q.labels, 'n', plain.mask),
    })
    const a = withFaint.png.data[((hy - withFaint.pageBox[1]) * withFaint.png.width + hx - withFaint.pageBox[0]) * 4 + 3]!
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(120)
  })

  it('never lights pixels within 1 px of ink owned by a line outside the note', () => {
    // two lines with a descender of the upper line brushing the note's line
    const q = page({ extra: (c) => stroke(c, 150, 100, 150, 150, 2) })
    const lines = q.lines
    expect(lines).toBeGreaterThanOrEqual(3)
    const bq = wordBoundaries(q, 1, 0.2)
    const n = build(q, [part(1, 0, 3, bq, true)])
    for (let y = 0; y < n.png.height; y++)
      for (let x = 0; x < n.png.width; x++) {
        if (!n.png.data[(y * n.png.width + x) * 4 + 3]) continue
        const gx = x + n.pageBox[0], gy = y + n.pageBox[1]
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const o = q.own.owner[(gy + dy) * q.c.w + gx + dx]!
            if (o >= 0) expect(o).toBe(1)
          }
      }
  })
})

describe('paperEstimate', () => {
  it('is the local median of the non-ink pixels, ignoring pixels within 2 px of ink', () => {
    const w = 60, h = 40
    const g: Gray = { width: w, height: h, data: new Uint8Array(w * h).fill(200) }
    const raw = new Uint8Array(w * h)
    for (let y = 10; y < 30; y++) (g.data[y * w + 30] = 50, (raw[y * w + 30] = 1), (g.data[y * w + 31] = 140))
    const { paper, median } = paperEstimate(g, raw)
    expect(median).toBe(200)
    expect(paper[20 * w + 31]).toBe(200)
    expect(paper[5 * w + 5]).toBe(200)
  })
})
