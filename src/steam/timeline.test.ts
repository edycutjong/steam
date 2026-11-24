import { describe, expect, it } from 'vitest'
import {
  HEAD_FADE_MS,
  LEAD_MS,
  PHASE_ORDER,
  REFOG_MS,
  THICKEN_MS,
  WIPE_MS,
  WRITE_ON_MS,
  revealState,
} from './timeline.ts'

const W = WRITE_ON_MS
const wipeAt = W + 3000

describe('constants', () => {
  it('respect the hard limits', () => {
    expect(WRITE_ON_MS).toBeLessThanOrEqual(6000)
    expect(THICKEN_MS).toBeLessThanOrEqual(LEAD_MS)
  })
})

describe('revealState boundaries', () => {
  it('is fogged before the thickening window', () => {
    expect(revealState(-THICKEN_MS - 1, null)).toMatchObject({ phase: 'fogged', u: -1, thicken: 0 })
  })
  it('starts thickening at -THICKEN_MS', () => {
    const s = revealState(-THICKEN_MS, null)
    expect(s.phase).toBe('thickening')
    expect(s.thicken).toBe(0)
  })
  it('is almost fully thick at -1 and still not writing', () => {
    const s = revealState(-1, null)
    expect(s.phase).toBe('thickening')
    expect(s.u).toBe(-1)
    expect(s.thicken).toBeGreaterThan(0.99)
    expect(s.thicken).toBeLessThan(1)
  })
  it('starts writing at 0', () => {
    expect(revealState(0, null)).toMatchObject({ phase: 'writing', u: 0, thicken: 1, head: 0 })
  })
  it('is still writing one ms before the end', () => {
    const s = revealState(W - 1, null)
    expect(s.phase).toBe('writing')
    expect(s.u).toBeCloseTo((W - 1) / W, 12)
  })
  it('holds exactly at WRITE_ON_MS', () => {
    expect(revealState(W, null)).toMatchObject({ phase: 'holding', u: 1, head: 0 })
  })
  it('holds one ms before the wipe, wipes at wipeAt', () => {
    expect(revealState(wipeAt - 1, wipeAt).phase).toBe('holding')
    expect(revealState(wipeAt, wipeAt)).toMatchObject({ phase: 'wiped', wipe: 0, refog: 0 })
  })
  it('finishes the sweep at wipeAt + WIPE_MS, refog still 0', () => {
    expect(revealState(wipeAt + WIPE_MS, wipeAt)).toMatchObject({ wipe: 1, refog: 0 })
  })
  it('has full refog after WIPE_MS + REFOG_MS', () => {
    expect(revealState(wipeAt + WIPE_MS + REFOG_MS, wipeAt)).toMatchObject({ wipe: 1, refog: 1 })
  })
})

describe('u', () => {
  it('is -1 for all t < 0', () => {
    for (let t = -10000; t < 0; t += 137) expect(revealState(t, null).u).toBe(-1)
  })
  it('is linear while writing', () => {
    for (let t = 0; t < W; t += 97) expect(revealState(t, null).u).toBeCloseTo(t / W, 12)
  })
  it('is 1 at and after WRITE_ON_MS', () => {
    for (const t of [W, W + 1, wipeAt, wipeAt + 1e6]) expect(revealState(t, wipeAt).u).toBe(1)
  })
})

describe('monotonic sweep', () => {
  it('u, thicken, wipe, refog never decrease', () => {
    let prev = revealState(-5000, wipeAt)
    for (let t = -5000; t <= wipeAt + WIPE_MS + REFOG_MS + 1000; t += 53) {
      const s = revealState(t, wipeAt)
      expect(s.u).toBeGreaterThanOrEqual(prev.u)
      expect(s.thicken).toBeGreaterThanOrEqual(prev.thicken)
      expect(s.wipe).toBeGreaterThanOrEqual(prev.wipe)
      expect(s.refog).toBeGreaterThanOrEqual(prev.refog)
      expect(PHASE_ORDER.indexOf(s.phase)).toBeGreaterThanOrEqual(PHASE_ORDER.indexOf(prev.phase))
      prev = s
    }
  })
  it('holding never lowers u and refog stays 0 before the sweep ends', () => {
    for (let t = W; t < wipeAt + WIPE_MS; t += 41) {
      const s = revealState(t, wipeAt)
      expect(s.u).toBe(1)
      expect(s.refog).toBe(0)
    }
  })
})

describe('writing head', () => {
  it('ramps in and out over HEAD_FADE_MS', () => {
    expect(revealState(HEAD_FADE_MS / 2, null).head).toBeCloseTo(0.5, 12)
    expect(revealState(W / 2, null).head).toBe(1)
    expect(revealState(W - HEAD_FADE_MS / 2, null).head).toBeCloseTo(0.5, 12)
  })
})

describe('bad input', () => {
  it('treats NaN and infinities as fogged', () => {
    for (const t of [NaN, Infinity, -Infinity]) {
      expect(revealState(t, null)).toMatchObject({ phase: 'fogged', u: -1, thicken: 0 })
    }
  })
  it('clamps wipeAt below WRITE_ON_MS', () => {
    expect(revealState(W - 1, 100).phase).toBe('writing')
    expect(revealState(W, 100).phase).toBe('wiped')
    expect(revealState(W, -50).phase).toBe('wiped')
  })
  it('ignores a non-finite wipeAt', () => {
    expect(revealState(W + 10000, NaN).phase).toBe('holding')
    expect(revealState(W + 10000, Infinity).phase).toBe('holding')
  })
})
