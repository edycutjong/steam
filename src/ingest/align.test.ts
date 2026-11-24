import { describe, expect, it } from 'vitest'
import { alignAuto, assignWords } from './align.ts'
import type { Run } from './runs.ts'

const run = (index: number, x0: number, width: number): Run => ({ index, x0, x1: x0 + width - 1, width })

describe('alignAuto (R18.3, R18.4)', () => {
  it('accepts k words with k-1 clear gaps, boundaries at the run centres, sorted left to right', () => {
    const runs = [run(0, 40, 6), run(1, 100, 14), run(2, 160, 5), run(3, 220, 16)]
    const r = alignAuto(runs, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error()
    expect(r.chosen.map((u) => u.index)).toEqual([1, 3])
    expect(r.boundaries).toEqual([Math.floor((100 + 113) / 2), Math.floor((220 + 235) / 2)])
  })
  it('is ambiguous with fewer than k-1 runs and reports the numbers', () => {
    const r = alignAuto([run(0, 10, 8)], 4)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error()
    expect(r.reason).toBe('alignment ambiguous')
    expect(r.detail).toMatch(/alignment ambiguous: 1 runs, need 3/)
  })
  it('is ambiguous on a tie at the cut (the (k-1)th run is not strictly wider than the next)', () => {
    const r = alignAuto([run(0, 10, 12), run(1, 50, 9), run(2, 90, 9)], 3)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error()
    expect(r.detail).toContain('9')
  })
  it('is ambiguous when the (k-1)th run is under 1.5x the median of the rest', () => {
    // widest two are 12 and 10, unselected 8, 8, 7 -> median 8, need 12 for the 2nd widest: 10 < 12
    const runs = [run(0, 10, 12), run(1, 50, 10), run(2, 90, 8), run(3, 130, 8), run(4, 170, 7)]
    const r = alignAuto(runs, 3)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error()
    expect(r.detail).toMatch(/1\.5 x median of the rest 8 = 12/)
  })
  it('accepts when the (k-1)th run is exactly 1.5x the median', () => {
    const runs = [run(0, 10, 12), run(1, 50, 12 - 0), run(2, 90, 8), run(3, 130, 8), run(4, 170, 8)]
    expect(alignAuto(runs, 3).ok).toBe(true) // selected 12 and 12, next 8: strictly wider; 12 >= 1.5 x 8
  })
  it('uses 4 as the median when nothing is unselected', () => {
    expect(alignAuto([run(0, 10, 6), run(1, 50, 6)], 3).ok).toBe(true) // 6 >= 1.5 * 4
    expect(alignAuto([run(0, 10, 5), run(1, 50, 5)], 3).ok).toBe(false) // 5 < 6
  })
  it('a one-word line needs no boundary', () => {
    const r = alignAuto([], 1)
    expect(r.ok && r.boundaries).toEqual([])
  })
  it('breaks equal widths by position, left first', () => {
    const r = alignAuto([run(0, 10, 20), run(1, 60, 10), run(2, 110, 10)], 2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.chosen[0]!.index).toBe(0)
  })
})

describe('assignWords', () => {
  it('numbers words by sheared column between the boundaries', () => {
    const xs = Int32Array.from([5, 30, 31, 80])
    const ys = Int32Array.from([10, 10, 10, 10])
    expect([...assignWords({ xs, ys }, 10, 0, [20, 60])]).toEqual([0, 1, 1, 2])
  })
})
