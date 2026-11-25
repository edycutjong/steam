import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CookBench, frameStats, pass } from './cook-stats.ts'

describe('measure-cook statistics (R26.2)', () => {
  it('mean fps, minimum fps, worst frame and the count over 18.2 ms on fixed arrays', () => {
    const s = frameStats([16.7, 16.7, 16.6, 33.4])
    expect(s.frames).toBe(4)
    expect(s.meanFps).toBeCloseTo((4 * 1000) / 83.4, 2)
    expect(s.worstFrameMs).toBe(33.4)
    expect(s.minFps).toBeCloseTo(1000 / 33.4, 2)
    expect(s.over18_2ms).toBe(1)
    expect(pass(s)).toBe(false)
    expect(pass(frameStats(Array(60).fill(16.67)))).toBe(true)
    expect(frameStats([18.2]).over18_2ms).toBe(0)
    expect(frameStats([]).frames).toBe(0)
  })
  it('bench/cook.json, when committed, has the shape the script writes', () => {
    if (!existsSync('bench/cook.json')) return
    expect(CookBench.safeParse(JSON.parse(readFileSync('bench/cook.json', 'utf8'))).error?.issues ?? []).toEqual([])
  })
})
