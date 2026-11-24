// P4 (a) to (c) on generated owner maps, quoted subsets and word boundaries.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import type { Gray, Rgba } from './image.ts'
import { noteOwnership, ownership, type Bands } from './masks.ts'
import { checkP4, independentMask, type P4Part } from './props.ts'
import { collectLinePixels, zeroRuns } from './runs.ts'
import { blank, mulberry32, textRow } from './synth.ts'
import { buildNote, noteMask, type BuiltPart } from './timeofink.ts'
import { rawInk } from './threshold.ts'

function scene(seed: number, nLines: number) {
  const rnd = mulberry32(seed)
  const c = blank(300, 40 + nLines * 64)
  const cores: [number, number][] = []
  const valleys: number[] = []
  for (let i = 0; i < nLines; i++) {
    const yc = 40 + i * 64
    textRow(c, { yc, hh: 12 + Math.floor(rnd() * 8), x0: 12 + Math.floor(rnd() * 10), words: [2 + Math.floor(rnd() * 3), 3, 2 + Math.floor(rnd() * 3)], gap: 10 + Math.floor(rnd() * 8), slant: rnd() * 0.4 })
    cores.push([yc - 8, yc + 8])
    if (i + 1 < nLines) valleys.push(yc + 32)
  }
  const bands: Bands = { cores, valleys }
  const gray: Gray = { width: c.w, height: c.h, data: c.ink.map((v, i) => (v ? 50 + ((i * 7) % 60) : 228)) }
  const scan: Rgba = { width: c.w, height: c.h, data: new Uint8Array(c.w * c.h * 4) }
  for (let i = 0; i < c.w * c.h; i++) scan.data.set([gray.data[i]!, gray.data[i]!, gray.data[i]!, 255], i * 4)
  const labels = labelComponents(c.ink, c.w, c.h)
  return { c, bands, gray, scan, labels, own: ownership(labels, bands), raw: rawInk(gray), rnd }
}

const arb = fc.record({ seed: fc.integer({ min: 1, max: 1e9 }), n: fc.integer({ min: 2, max: 5 }) })

function pickParts(sc: ReturnType<typeof scene>, s: number): BuiltPart[] {
  const n = sc.bands.cores.length
  const lp = collectLinePixels(sc.own.owner, sc.c.w, sc.c.h, n)
  const lines = [...Array(n).keys()].filter(() => sc.rnd() < 0.5)
  if (lines.length === 0) lines.push(Math.floor(sc.rnd() * n))
  return lines.map((line) => {
    const yMid = (sc.bands.cores[line]![0] + sc.bands.cores[line]![1]) / 2
    const r = zeroRuns(lp[line]!, yMid, s)
    const k = Math.min(r.runs.length, 1 + Math.floor(sc.rnd() * 3))
    const chosen = [...r.runs].sort(() => sc.rnd() - 0.5).slice(0, k).sort((a, b) => a.x0 - b.x0)
    const boundaries = chosen.map((u) => Math.floor((u.x0 + u.x1) / 2))
    const whole = boundaries.length === 0 || sc.rnd() < 0.3
    const from = whole ? 0 : Math.floor(sc.rnd() * (boundaries.length + 1))
    const to = whole ? boundaries.length : from + Math.floor(sc.rnd() * (boundaries.length + 1 - from))
    return { line, fromWord: from, toWord: to, method: whole ? 'lines' : 'auto', boundaries: whole ? [] : boundaries, whole, autoDetail: '' } as BuiltPart
  })
}

const p4parts = (sc: ReturnType<typeof scene>, parts: BuiltPart[]): P4Part[] =>
  parts.map((p) => ({ line: p.line, boundaries: p.whole ? null : p.boundaries, fromWord: p.fromWord, toWord: p.toWord, yMid: (sc.bands.cores[p.line]![0] + sc.bands.cores[p.line]![1]) / 2 }))

describe('P4 note fidelity', () => {
  it('(a) (b): every built note passes, and the checker agrees with a direct statement of the rule', () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: 0, max: 8 }), ({ seed, n }, s10) => {
        const s = s10 / 20
        const sc = scene(seed, n)
        const parts = pickParts(sc, s)
        const mask = noteMask(sc.own, sc.bands, s, parts)
        if (!mask.some((v) => v)) return
        const note = buildNote({
          noteId: 'n', step: 1, span: 'x', shownText: 'x', granularity: 'words', alignment: 'auto', credit: 'c', scan: sc.scan, gray: sc.gray,
          raw: sc.raw, pageInk: sc.c.ink, own: sc.own, bands: sc.bands, s, resampled: false, parts, ownership: noteOwnership(sc.own, sc.labels, 'n', mask),
        })
        const r = checkP4({ noteId: 'n', width: sc.c.w, height: sc.c.h, owner: sc.own.owner, pageInk: sc.c.ink, s, parts: p4parts(sc, parts), png: note.png, pageBox: note.pageBox })
        expect(r.detail).toMatch(/lit px/)
        expect(r.pass).toBe(true)
        // independent mask equals the build's mask
        expect(independentMask({ width: sc.c.w, height: sc.c.h, owner: sc.own.owner, s, parts: p4parts(sc, parts) })).toEqual(mask)
        // (b) no pixel of a line outside Q is lit
        const Q = new Set(parts.map((p) => p.line))
        for (let y = 0; y < note.png.height; y++)
          for (let x = 0; x < note.png.width; x++) {
            if (!note.png.data[(y * note.png.width + x) * 4 + 3]) continue
            const o = sc.own.owner[(y + note.pageBox[1]) * sc.c.w + x + note.pageBox[0]]!
            if (o >= 0) expect(Q.has(o)).toBe(true)
          }
      }),
      { numRuns: 40 },
    )
  })

  it('(d) lighting any one pixel of a line outside Q fails P4', () => {
    fc.assert(
      fc.property(arb, fc.nat(), ({ seed, n }, pick) => {
        const sc = scene(seed, n)
        const parts = pickParts(sc, 0)
        const mask = noteMask(sc.own, sc.bands, 0, parts)
        if (!mask.some((v) => v)) return
        const Q = new Set(parts.map((p) => p.line))
        const others: number[] = []
        for (let i = 0; i < sc.own.owner.length; i++) if (sc.own.owner[i]! >= 0 && !Q.has(sc.own.owner[i]!)) others.push(i)
        if (!others.length) return
        // a full-page "note" (pageBox = page) whose alpha is the mask plus one foreign pixel
        const png: Rgba = { width: sc.c.w, height: sc.c.h, data: new Uint8Array(sc.c.w * sc.c.h * 4) }
        for (let i = 0; i < mask.length; i++) if (mask[i]) png.data[i * 4 + 3] = 255
        const ok = checkP4({ noteId: 'n', width: sc.c.w, height: sc.c.h, owner: sc.own.owner, pageInk: sc.c.ink, s: 0, parts: p4parts(sc, parts), png, pageBox: [0, 0, sc.c.w, sc.c.h] })
        expect(ok.pass).toBe(true)
        png.data[others[pick % others.length]! * 4 + 3] = 1
        const bad = checkP4({ noteId: 'n', width: sc.c.w, height: sc.c.h, owner: sc.own.owner, pageInk: sc.c.ink, s: 0, parts: p4parts(sc, parts), png, pageBox: [0, 0, sc.c.w, sc.c.h] })
        expect(bad.pass).toBe(false)
        expect(bad.detail).toMatch(/owned by line/)
      }),
      { numRuns: 60 },
    )
  })

  it('(c) the mask does not change when the reading text changes but the indices stay', () => {
    fc.assert(
      fc.property(arb, ({ seed, n }) => {
        const sc = scene(seed, n)
        const parts = pickParts(sc, 0.1)
        // note text is not an input of noteMask at all; build twice with different captions and compare the pixels
        const a = noteMask(sc.own, sc.bands, 0.1, parts)
        if (!a.some((v) => v)) return
        const mk = (span: string) =>
          buildNote({
            noteId: 'n', step: 1, span, shownText: span, granularity: 'words', alignment: 'auto', credit: 'c', scan: sc.scan, gray: sc.gray,
            raw: sc.raw, pageInk: sc.c.ink, own: sc.own, bands: sc.bands, s: 0.1, resampled: false, parts, ownership: noteOwnership(sc.own, sc.labels, 'n', a),
          })
        const x = mk('till it Looks')
        const y = mk('tell yt Lookes')
        expect(x.png.data).toEqual(y.png.data)
        expect(x.toi.data).toEqual(y.toi.data)
      }),
      { numRuns: 15 },
    )
  })
})
