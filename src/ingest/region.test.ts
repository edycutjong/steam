import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { chooseRegion, columnGroups, findBlocks, findLines, findMarginalia, findSeparators, rowProfile } from './lines.ts'
import { blank, rule, stroke, textRow, type Canvas } from './synth.ts'

const W = 600
const P = 70

/** Two groups of text rows (4 and 6 lines) with a full-width rule between them; optionally a margin mark. */
function twoBlocks(opts: { joinRule?: boolean; margin?: boolean } = {}) {
  const c = blank(W, 900)
  const rows = [90, 160, 230, 300, 470, 540, 610, 680, 750, 820]
  rows.forEach((yc, i) => textRow(c, { yc, hh: 14, x0: 120, words: [4, 3, 5, 4], gap: 14, slant: 0.2 + i * 0 }))
  rule(c, 385, 100, 580, 3)
  if (opts.joinRule) stroke(c, 300, 300, 300, 385, 2) // a stroke from the last letters of line 4 into the rule
  if (opts.margin) {
    for (const yc of [580, 650]) stroke(c, 40, yc - 25, 40, yc + 25, 3) // a bracket in the left margin
  }
  return c
}

function analyse(c: Canvas) {
  const labels = labelComponents(c.ink, c.w, c.h)
  const found = findLines(rowProfile(c.ink, c.w, c.h))
  const colWidth = 480
  const seps = findSeparators(c.ink, labels, { pitch: found.pitch, colWidth })
  return { labels, found, seps }
}

describe('separators and blocks', () => {
  it('finds the rule and cuts two blocks; the larger is chosen by default', () => {
    const c = twoBlocks()
    const { seps } = analyse(c)
    expect(seps.length).toBe(1)
    expect(seps[0]!.y0).toBeLessThanOrEqual(386)
    expect(seps[0]!.y1).toBeGreaterThanOrEqual(385)
    const cleaned = c.ink.slice()
    for (let y = seps[0]!.y0; y <= seps[0]!.y1; y++) cleaned.fill(0, y * W, (y + 1) * W)
    const found = findLines(rowProfile(cleaned, c.w, c.h))
    const blocks = findBlocks(found.lines, seps, c.h)
    expect(blocks.map((b) => b.lineIdx.length)).toEqual([4, 6])
    const r = chooseRegion(blocks, found.lines, found.pitch)
    expect(r).toMatchObject({ blockIndex: 1, selectedBy: 'default' })
  })
  it('finds a rule joined to the last line by a stroke (row test)', () => {
    const { seps } = analyse(twoBlocks({ joinRule: true }))
    expect(seps.length).toBe(1)
    expect(seps[0]!.method).toContain('row-run')
  })
  it('does not take a text line for a separator', () => {
    const c = blank(W, 200)
    textRow(c, { yc: 100, hh: 14, x0: 20, words: [9, 9, 9, 9, 9, 9], gap: 3, slant: 0.1 })
    const labels = labelComponents(c.ink, c.w, c.h)
    expect(findSeparators(c.ink, labels, { pitch: 70, colWidth: 480 }).length).toBe(0)
  })
  it('selects the first block with --block 0 and records the curator', () => {
    const c = twoBlocks()
    const { found, seps } = analyse(c)
    const blocks = findBlocks(found.lines.filter((l) => l.peakRow < 380 || l.peakRow > 390), seps, c.h)
    const r = chooseRegion(blocks, found.lines.filter((l) => l.peakRow < 380 || l.peakRow > 390), found.pitch, 0)
    expect(r.selectedBy).toBe('curator')
    expect(r.blockIndex).toBe(0)
    expect(() => chooseRegion(blocks, found.lines, found.pitch, 5)).toThrow(/not one of the 2 blocks/)
  })
  it('extends the region rows by P/2 and clips at the rule', () => {
    const c = twoBlocks()
    const { found, seps } = analyse(c)
    const cleaned = c.ink.slice()
    for (let y = seps[0]!.y0; y <= seps[0]!.y1; y++) cleaned.fill(0, y * W, (y + 1) * W)
    const prof = rowProfile(cleaned, c.w, c.h)
    const f2 = findLines(prof)
    const blocks = findBlocks(f2.lines, seps, c.h)
    const r0 = chooseRegion(blocks, f2.lines, f2.pitch, 0)
    const r1 = chooseRegion(blocks, f2.lines, f2.pitch, 1)
    const half = Math.round(f2.pitch / 2)
    expect(r0.y0).toBe(Math.max(0, f2.lines[0]!.core[0] - half))
    expect(r0.y1).toBe(Math.min(seps[0]!.y0, f2.lines[3]!.core[1] + 1 + half))
    expect(r0.y1).toBeLessThanOrEqual(seps[0]!.y0)
    expect(r1.y0).toBeGreaterThan(seps[0]!.y1)
    expect(r1.y1).toBe(Math.min(c.h, f2.lines[9]!.core[1] + 1 + half))
    expect(found.lines.length).toBeGreaterThanOrEqual(10)
  })
})

describe('column groups and marginalia', () => {
  it('splits at gaps of at least minGap empty columns', () => {
    const col = new Float64Array(40)
    for (const x of [2, 3, 4, 9, 10, 30]) col[x] = 1
    expect(columnGroups(col, 5).map((g) => [g.x0, g.x1])).toEqual([[2, 11], [30, 31]])
    expect(columnGroups(col, 4).map((g) => [g.x0, g.x1])).toEqual([[2, 5], [9, 11], [30, 31]])
  })
  it('a margin mark separated by a gap of P/2 or more becomes marginalia and is not in the text column', () => {
    const c = twoBlocks({ margin: true })
    const m = findMarginalia(c.ink, c.w, 500, 800, P)
    expect(m.marginalia.length).toBe(1)
    expect(m.marginalia[0]!.box[0]).toBeLessThan(60)
    expect(m.x0).toBeGreaterThanOrEqual(110)
    expect(m.marginalia[0]!.inkPx).toBeGreaterThan(100)
  })
  it('without a margin mark there is no marginalia', () => {
    const c = twoBlocks()
    expect(findMarginalia(c.ink, c.w, 500, 800, P).marginalia).toEqual([])
  })
})
