import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { GAP_INK_A, GAP_MIN_PX, buildSplits, findGaps } from './gaps.ts'
import { MIN_CORE_CSS_PX, PAD_PX, computeLayout, type LayoutMeta } from './layout.ts'

const dir = new URL('../../public/recipes/quinces-marmalade/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('note-till-it-looks-red-smooth.json', dir), 'utf8')) as LayoutMeta & { groups: { rect: [number, number, number, number]; coreBand: [number, number]; t: [number, number] }[] }
const toi = PNG.sync.read(readFileSync(new URL('note-till-it-looks-red-smooth.toi.png', dir)))
const { width: w, height: h } = toi
const ink = new Uint8Array(w * h)
for (let p = 0; p < w * h; p++) ink[p] = toi.data[p * 4]
const input = { ink, toi: toi.data, width: w, height: h, groups: meta.groups }
const splits = buildSplits(input)

describe('findGaps', () => {
  it('finds interior gaps of at least 18 note px in a synthetic line', () => {
    const W = 100
    const img = new Uint8Array(W * 10)
    for (let y = 2; y < 8; y++) for (let x = 0; x < W; x++) if (x < 30 || (x >= 52 && x < 80) || x >= 84) img[y * W + x] = 200
    const gaps = findGaps({ ink: img, width: W, height: 10 }, [0, 0, W, 10])
    expect(gaps).toEqual([[30, 52]]) // the 4 px gap at 80..84 is too narrow
  })
  it('never reports a gap at the edge of the rect', () => {
    const img = new Uint8Array(50 * 4).fill(0)
    for (let y = 0; y < 4; y++) for (let x = 20; x < 30; x++) img[y * 50 + x] = 255
    expect(findGaps({ ink: img, width: 50, height: 4 }, [0, 0, 50, 4])).toEqual([])
  })
})

describe('buildSplits on the hero note', () => {
  it('offers a cut for the second line (too wide for a phone at the minimum core band)', () => {
    expect(splits[1]).not.toBeNull()
  })
  it('the layout cuts only a line that cannot keep the minimum core band: the first stays whole', () => {
    const l = computeLayout('groups', 373, 226, meta, splits)
    expect(l.groups.filter((g) => g.index === 0)).toHaveLength(1)
    expect(l.groups.filter((g) => g.index === 1)).toHaveLength(2)
  })
  it('the parts tile the ink of the line: no ink lost, none doubled (R8.4)', () => {
    const [l, r] = splits[1]!
    const [x0, y0, x1, y1] = meta.groups[1].rect
    let total = 0
    let inL = 0
    let inR = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (ink[y * w + x] < GAP_INK_A) continue
        total++
        if (x >= l.rect[0] && x < l.rect[2] && y >= l.rect[1] && y < l.rect[3]) inL++
        if (x >= r.rect[0] && x < r.rect[2] && y >= r.rect[1] && y < r.rect[3]) inR++
      }
    expect(inL + inR).toBe(total)
    expect(l.rect[2]).toBeLessThanOrEqual(r.rect[0] - GAP_MIN_PX)
  })
  it('orders the parts by time-of-ink, so the head reads left to right', () => {
    const [l, r] = splits[1]!
    expect(l.t[0]).toBeLessThanOrEqual(r.t[0])
    expect(l.clip[1]).toBe(r.clip[0])
  })
})

describe('phone layout with gap groups (P-L1, R8)', () => {
  it('every placed group keeps its core band and 12 css px of clear glass either side, at widths 330 to 430', () => {
    fc.assert(
      fc.property(fc.integer({ min: 330, max: 430 }), fc.integer({ min: 360, max: 700 }), (pw, ph) => {
        const paneW = pw - 20 // the bars
        const l = computeLayout('groups', paneW, ph, meta, splits)
        return (
          l.groups.length >= 2 &&
          l.groups.length <= 4 &&
          l.groups.every((g) => g.coreBandCssPx >= MIN_CORE_CSS_PX - 1e-9 && g.inked[0] >= 12 && paneW - g.inked[2] >= 12 && g.inked[0] >= PAD_PX - 1e-9)
        )
      }),
    )
  })
  it('at 390 and 393 css px every core band is at least 16 css px and the cut line is stacked in reading order', () => {
    for (const pw of [370, 373]) {
      const l = computeLayout('groups', pw, 226, meta, splits)
      expect(l.fits).toBe(true)
      expect(l.groups.map((g) => [g.index, g.part])).toEqual([[0, 0], [1, 0], [1, 1]])
      for (const g of l.groups) expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
      for (let i = 1; i < l.groups.length; i++) expect(l.groups[i].inked[1]).toBeGreaterThanOrEqual(l.groups[i - 1].inked[3])
    }
  })
  it('keeps the two parts of a cut line at one scale, and never carries the other part’s ink in a part’s source', () => {
    const l = computeLayout('groups', 373, 226, meta, splits)
    const [, a, b] = l.groups
    expect(a.scale).toBe(b.scale)
    expect(a.src[2]).toBeLessThanOrEqual(b.src[0] + 1e-9)
  })
  it('without a split the old two-group phone layout is unchanged', () => {
    const l = computeLayout('groups', 373, 500, meta)
    expect(l.groups.map((g) => g.index)).toEqual([0, 1])
  })
})
