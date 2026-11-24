import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { SPLIT_SHARE_MAX } from './constants.ts'
import { applyReview, noteOwnership, ownership, shareWithinThreshold, splitShare, type Bands } from './masks.ts'
import { checkP3, checkP3Notes } from './props.ts'

const bands: Bands = { cores: [[10, 20], [40, 50]], valleys: [30] }
const W = 120
const H = 70

/** A page with one joined stroke of `joined` px (a vertical line from row 15 to row 45) and a plain blob of `plain` px in band 0. */
function scene(plainCols: number) {
  const ink = new Uint8Array(W * H)
  for (let y = 15; y <= 45; y++) ink[y * W + 3] = 1 // 31 px joined component, split at 30
  for (let k = 0; k < plainCols; k++) for (let y = 12; y <= 14; y++) ink[y * W + 20 + k] = 1 // 3 px per column, band 0 only
  const labels = labelComponents(ink, W, H)
  const own = ownership(labels, bands)
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < mask.length; i++) mask[i] = ink[i]! && own.owner[i]! >= 0 ? 1 : 0
  return { ink, labels, own, mask }
}

describe('constants', () => {
  it('the split threshold is frozen at 0.02', () => expect(SPLIT_SHARE_MAX).toBe(0.02))
})

describe('splitShare', () => {
  it('is split pixels over mask pixels', () => {
    const s = scene(10) // 31 + 30 = 61 mask px, 31 split
    const r = splitShare(s.own, s.labels, s.mask)
    expect(r.maskPx).toBe(61)
    expect(r.splitPx).toBe(31)
    expect(r.share).toBeCloseTo(31 / 61, 12)
    expect(r.contributing).toEqual([3 + 15 * W])
  })
  it('lists only split components that contribute mask pixels', () => {
    const s = scene(10)
    const mask = new Uint8Array(W * H)
    for (let y = 12; y <= 14; y++) for (let x = 20; x < 30; x++) mask[y * W + x] = 1
    expect(splitShare(s.own, s.labels, mask).contributing).toEqual([])
  })
})

describe('the 0.02 threshold', () => {
  it('passes at exactly 0.02 and fails with one more pixel', () => {
    expect(shareWithinThreshold(2, 100)).toBe(true)
    expect(shareWithinThreshold(3, 100)).toBe(false)
    expect(shareWithinThreshold(31, 1550)).toBe(true) // exactly 0.02
    expect(shareWithinThreshold(31, 1549)).toBe(false)
    expect(shareWithinThreshold(0, 0)).toBe(true)
  })
  it('a note exactly at 0.02 is auto; one split pixel more is failed with "joined strokes: needs review"', () => {
    const WW = 1600
    const bw: Bands = { cores: [[10, 20], [40, 50]], valleys: [30] }
    const build = (plainPx: number) => {
      const ink = new Uint8Array(WW * 60)
      for (let y = 15; y <= 45; y++) ink[y * WW + 3] = 1 // 31 px joined component, split at the valley
      for (let k = 0; k < plainPx; k++) ink[(12 + (k % 3)) * WW + 10 + Math.floor(k / 3)] = 1
      const labels = labelComponents(ink, WW, 60)
      return { labels, own: ownership(labels, bw), mask: ink }
    }
    const at = build(1519)
    const a = noteOwnership(at.own, at.labels, 'n', at.mask)
    expect(a.maskPx).toBe(1550)
    expect(a.share).toBe(0.02)
    expect(a.status).toBe('auto')
    const over = build(1518)
    const o = noteOwnership(over.own, over.labels, 'n', over.mask)
    expect(o.maskPx).toBe(1549)
    expect(o.status).toBe('failed')
    expect(o.flagged).toEqual([3 + 15 * WW])
    const p3 = checkP3Notes([o])
    expect(p3.result.pass).toBe(false)
    expect(p3.result.detail).toContain('joined strokes: needs review')
  })
})

describe('checkP3Notes', () => {
  it('passes an all-auto set and counts auto and reviewed separately', () => {
    const a = { noteId: 'a', maskPx: 10, splitPx: 0, share: 0, flagged: [], decided: [], reviewers: [], status: 'auto' as const }
    const r = { noteId: 'r', maskPx: 10, splitPx: 5, share: 0.5, flagged: [1, 2], decided: [1, 2], reviewers: ['A. Person'], status: 'reviewed' as const }
    const s = checkP3Notes([a, r])
    expect(s.result.pass).toBe(true)
    expect(s.autoPass).toBe(1)
    expect(s.reviewedPass).toBe(1)
    expect(s.result.detail).toContain('reviewed (2 components, by A. Person)')
  })
})

describe('checkP3 (the evaluator over a real owner map)', () => {
  const bands2: Bands = { cores: [[10, 20], [40, 50]], valleys: [30] }
  const mkScene = () => {
    const ink = new Uint8Array(W * H)
    for (let y = 15; y <= 45; y++) ink[y * W + 3] = 1
    for (let x = 20; x < 40; x++) for (let y = 12; y < 15; y++) ink[y * W + x] = 1
    const labels = labelComponents(ink, W, H)
    return { ink, labels, own: ownership(labels, bands2) }
  }
  it('passes a clean owner map and carries the notes\' verdict text', () => {
    const s = mkScene()
    const mask = new Uint8Array(W * H)
    for (let x = 20; x < 40; x++) for (let y = 12; y < 15; y++) mask[y * W + x] = 1
    const note = noteOwnership(s.own, s.labels, 'plain', mask)
    const r = checkP3({ labels: s.labels, own: s.own, bands: bands2, notes: [note] })
    expect(r.result.pass).toBe(true)
    expect(r.autoPass).toBe(1)
  })
  it('reports the joined strokes message with the note, share and component ids for a failing note', () => {
    const s = mkScene()
    const note = noteOwnership(s.own, s.labels, 'joined', s.ink)
    const r = checkP3({ labels: s.labels, own: s.own, bands: bands2, notes: [note] })
    expect(r.result.pass).toBe(false)
    expect(r.result.detail).toMatch(new RegExp(`^joined strokes: needs review \\(joined: split share 0\\.3\\d+ over 0\\.02, components ${15 * W + 3}\\)`))
  })
  it('fails an owner map with an unowned ink pixel, a stray owner, or a cut away from a valley row', () => {
    const s = mkScene()
    const a = { ...s.own, owner: s.own.owner.slice() }
    a.owner[20 * W + 3] = -1
    expect(checkP3({ labels: s.labels, own: a, bands: bands2, notes: [] }).result.detail).toMatch(/1 ink pixels have no owner/)
    const b = { ...s.own, owner: s.own.owner.slice() }
    b.owner[0] = 0
    expect(checkP3({ labels: s.labels, own: b, bands: bands2, notes: [] }).result.detail).toMatch(/1 non-ink pixels have an owner/)
    const c = { ...s.own, owner: s.own.owner.slice() }
    for (let y = 15; y <= 24; y++) c.owner[y * W + 3] = 1 // the cut moved from row 30 to row 25
    c.owner[25 * W + 3] = 1
    const r = checkP3({ labels: s.labels, own: c, bands: bands2, notes: [] })
    expect(r.result.pass).toBe(false)
    expect(r.result.detail).toMatch(/components \d+ are cut away from a valley row/)
  })
  it('a reviewed component is judged by its decision, and a reviewed note is not an automatic pass', () => {
    const s = mkScene()
    const id = 15 * W + 3
    const { own } = applyReview(s.labels, bands2, [{ componentId: id, decision: { splitAtRow: 24 }, reviewer: 'Kiro (agent), turn-18' }])
    const note = noteOwnership(own, s.labels, 'joined', s.ink)
    const r = checkP3({ labels: s.labels, own, bands: bands2, notes: [note] })
    expect(r.result.pass).toBe(true)
    expect(r.autoPass).toBe(0)
    expect(r.reviewedPass).toBe(1)
    expect(r.result.detail).toContain('joined reviewed (1 components, by Kiro (agent), turn-18)')
  })
})
