import { describe, expect, it } from 'vitest'
import { OwnershipReview } from '../data/schema.ts'
import { labelComponents } from './components.ts'
import { applyReview, noteOwnership, ownership, validateReview, type Bands, type ReviewInput } from './masks.ts'
import { checkP3Notes } from './props.ts'

const bands: Bands = { cores: [[10, 20], [40, 50], [70, 80]], valleys: [30, 60] }
const W = 80
const H = 100
function scene() {
  const ink = new Uint8Array(W * H)
  for (let y = 12; y <= 48; y++) ink[y * W + 5] = 1 // A: lines 0 and 1, 37 px
  for (let y = 42; y <= 78; y++) ink[y * W + 20] = 1 // B: lines 1 and 2
  for (let y = 12; y <= 18; y++) for (let x = 40; x < 60; x++) ink[y * W + x] = 1 // C: plain, line 0
  const labels = labelComponents(ink, W, H)
  return { ink, labels, A: 12 * W + 5, B: 42 * W + 20, C: 12 * W + 40 }
}
const rev = (componentId: number, decision: ReviewInput['decision'], reviewer = 'A. Person'): ReviewInput => ({ componentId, decision, reviewer })

describe('validateReview (R13.2)', () => {
  const s = scene()
  const base = ownership(s.labels, bands)
  it('accepts assignToLine only for a touched line', () => {
    expect(validateReview(base, bands, [rev(s.A, { assignToLine: 0 })])).toEqual([])
    expect(validateReview(base, bands, [rev(s.A, { assignToLine: 1 })])).toEqual([])
    expect(validateReview(base, bands, [rev(s.A, { assignToLine: 2 })])[0]).toMatch(new RegExp(`component ${s.A}: line 2 is not touched`))
  })
  it('accepts splitAtRow only between the touched bands (inclusive of the band edges)', () => {
    expect(validateReview(base, bands, [rev(s.A, { splitAtRow: 20 })])).toEqual([])
    expect(validateReview(base, bands, [rev(s.A, { splitAtRow: 40 })])).toEqual([])
    expect(validateReview(base, bands, [rev(s.A, { splitAtRow: 19 })])[0]).toMatch(/outside \[20, 40\]/)
    expect(validateReview(base, bands, [rev(s.A, { splitAtRow: 41 })])[0]).toMatch(/outside \[20, 40\]/)
  })
  it('refuses unknown components, one-band splits, and mixed or repeated decisions', () => {
    expect(validateReview(base, bands, [rev(999, { assignToLine: 0 })])[0]).toMatch(/component 999/)
    expect(validateReview(base, bands, [rev(s.C, { splitAtRow: 25 })])[0]).toMatch(/touches two lines/)
    expect(validateReview(base, bands, [rev(s.A, { assignToLine: 0 }), rev(s.A, { splitAtRow: 25 })])[0]).toMatch(/both/)
    expect(validateReview(base, bands, [rev(s.A, { assignToLine: 0 }), rev(s.A, { assignToLine: 1 })])[0]).toMatch(/more than one/)
  })
})

describe('applyReview (R13.3)', () => {
  const s = scene()
  it('assignToLine gives the whole component to that line and changes nothing else', () => {
    const base = ownership(s.labels, bands)
    const { own, errors } = applyReview(s.labels, bands, [rev(s.A, { assignToLine: 0 })])
    expect(errors).toEqual([])
    for (let i = 0; i < W * H; i++) {
      const id = s.labels.label[i]!
      if (id === s.A) expect(own.owner[i]).toBe(0)
      else expect(own.owner[i]).toBe(base.owner[i])
    }
    expect(own.components.get(s.A)!.reviewed).toBe(true)
    expect(own.components.get(s.B)!.reviewed).toBe(false)
    expect(own.splits.find((l) => l.componentId === s.A)!.review).toBe('assignToLine 0')
  })
  it('splitAtRow replaces the valley row for that component only', () => {
    const { own } = applyReview(s.labels, bands, [rev(s.A, { splitAtRow: 24 })])
    const base = ownership(s.labels, bands)
    expect(base.owner[24 * W + 5]).toBe(0) // the automatic cut is the valley row 30
    expect(own.owner[23 * W + 5]).toBe(0)
    expect(own.owner[24 * W + 5]).toBe(1)
    expect(own.owner[30 * W + 5]).toBe(1)
    for (let i = 0; i < W * H; i++) if (s.labels.label[i] !== s.A) expect(own.owner[i]).toBe(base.owner[i])
  })
  it('applies nothing when any decision is invalid', () => {
    const base = ownership(s.labels, bands)
    const { own, errors } = applyReview(s.labels, bands, [rev(s.A, { assignToLine: 0 }), rev(s.B, { assignToLine: 0 })])
    expect(errors.length).toBe(1)
    expect(own.owner).toEqual(base.owner)
  })
})

describe('a reviewed note (R13.4, R13.5, R13.6)', () => {
  const s = scene()
  const mask = s.ink.slice()
  for (let i = 0; i < mask.length; i++) if (s.labels.label[i] !== s.A && s.labels.label[i] !== s.C) mask[i] = 0
  it('fails without a review, passes as reviewed with it, and is not counted as an automatic pass', () => {
    const none = applyReview(s.labels, bands, [])
    const failed = noteOwnership(none.own, s.labels, 'n', mask)
    expect(failed.status).toBe('failed')
    expect(failed.flagged).toEqual([s.A])
    const p3 = checkP3Notes([failed])
    expect(p3.result.pass).toBe(false)
    const r = applyReview(s.labels, bands, [rev(s.A, { assignToLine: 0 }, 'Kiro (agent), turn-18')])
    const ok = noteOwnership(r.own, s.labels, 'n', mask)
    expect(ok.status).toBe('reviewed')
    expect(ok.reviewers).toEqual(['Kiro (agent), turn-18'])
    const p3ok = checkP3Notes([ok])
    expect(p3ok.result.pass).toBe(true)
    expect(p3ok.autoPass).toBe(0)
    expect(p3ok.reviewedPass).toBe(1)
    expect(p3ok.result.detail).toContain('n reviewed (1 components, by Kiro (agent), turn-18)')
  })
  it('a decision on another component does not review this note', () => {
    const r = applyReview(s.labels, bands, [rev(s.B, { assignToLine: 1 })])
    expect(noteOwnership(r.own, s.labels, 'n', mask).status).toBe('failed')
  })
  it('a stale review is reported as such', () => {
    const none = applyReview(s.labels, bands, [])
    const p3 = checkP3Notes([noteOwnership(none.own, s.labels, 'n', mask)], { staleReview: true })
    expect(p3.result.detail).toMatch(/^stale ownership review/)
  })
  it('the OwnershipReview schema carries the same decision shape', () => {
    const file = { segmentRun: { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }, decisions: [{ componentId: s.A, overlay: 'ownership/flag.png', decision: { assignToLine: 0 }, reviewer: 'x', rationale: 'y' }] }
    expect(OwnershipReview.safeParse(file).success).toBe(true)
  })
})
