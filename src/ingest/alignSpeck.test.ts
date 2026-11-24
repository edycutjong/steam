// word-align-speck: the extent rule and the ink floor on small hand-made lines.
import { describe, expect, it } from 'vitest'
import { alignAuto, alignCurator, alignPart } from './align.ts'
import { WORD_INK_MIN_PX, MIN_COMPONENT_PX } from './constants.ts'
import { wordInkCounts, zeroRuns, type LinePixels } from './runs.ts'

/** A vertical line's pixels from column blocks: [x0, x1, big]; 3 rows each (s = 0, so x' = x). */
function line(blocks: [number, number, boolean][]): LinePixels {
  const xs: number[] = []
  const ys: number[] = []
  const big: number[] = []
  for (const [x0, x1, b] of blocks) for (let x = x0; x <= x1; x++) for (let y = 0; y < (b ? 12 : 1); y++) (xs.push(x), ys.push(y), big.push(b ? 1 : 0))
  return { xs: Int32Array.from(xs), ys: Int32Array.from(ys), big: Uint8Array.from(big) }
}

describe('text extent', () => {
  it('a speck outside the writing does not stretch the extent and opens no run', () => {
    const words: [number, number, boolean][] = [[100, 120, true], [130, 150, true], [160, 180, true]]
    const clean = zeroRuns(line(words), 6, 0)
    const speck = zeroRuns(line([[10, 10, false], ...words, [300, 300, false]]), 6, 0)
    expect(speck).toEqual(clean)
    expect([speck.lo, speck.hi]).toEqual([100, 180])
  })
  it('a speck inside the writing still occupies its column', () => {
    const r = zeroRuns(line([[100, 120, true], [125, 125, false], [140, 160, true]]), 6, 0)
    expect(r.runs.map((x) => [x.x0, x.x1])).toEqual([[121, 124], [126, 139]])
  })
  it('without component sizes every pixel counts, as before', () => {
    const p = line([[10, 10, false], [100, 120, true]])
    delete p.big
    expect(zeroRuns(p, 6, 0).lo).toBe(10)
  })
})

describe('ink floor', () => {
  it('equals the piece floor', () => expect(WORD_INK_MIN_PX).toBe(MIN_COMPONENT_PX))
  const p = line([[100, 101, true], [130, 150, true], [160, 180, true]]) // word 0 holds 2 columns x 12 rows = 24 px
  const ink = (b: number[]) => wordInkCounts(p, 6, 0, b, [100, 180])
  const runs = zeroRuns(p, 6, 0).runs
  it('counts writing per word box inside the extent', () => {
    expect(ink([115, 155])).toEqual([24, 21 * 12, 21 * 12])
  })
  it('alignAuto rejects a candidate whose any word box holds less than the floor, and says which', () => {
    expect(alignAuto(runs, 3).ok).toBe(true)
    const r = alignAuto(runs, 3, ink)
    expect(r.ok).toBe(false)
    expect((r as { detail: string }).detail).toBe('alignment rejected: word 0 holds 24 ink px, under the floor 30')
  })
  it('alignCurator applies the same floor', () => {
    expect(alignCurator(runs, 3, [0, 1]).ok).toBe(true)
    expect(alignCurator(runs, 3, [0, 1], ink)).toEqual({ ok: false, detail: 'alignment.json: alignment rejected: word 0 holds 24 ink px, under the floor 30' })
  })
  it('alignPart falls back to whole lines and records why', () => {
    const r = alignPart({ line: 0, fromWord: 0, toWord: 0, tokenCount: 3, k: 3, runs, wordInk: ink, extent: [100, 180] })
    expect(r.method).toBe('lines')
    expect(r.reason).toMatch(/word 0 holds 24 ink px/)
  })
})
