import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KEEP_R, MOON_CENTRE, NIGHT_H, NIGHT_W, branchPaths } from './branches.ts'
import { MOON } from './NightView.tsx'

describe('branchPaths (P-B1)', () => {
  it('is deterministic for a seed', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => JSON.stringify(branchPaths(seed)) === JSON.stringify(branchPaths(seed))))
  })
  it('is finite, bounded and non-empty for any seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const layers = branchPaths(seed)
        if (layers.length < 3) return false
        for (const l of layers) {
          if (!(l.w > 0)) return false
          const nums = l.d.match(/-?\d+(\.\d+)?/g) ?? []
          if (nums.length === 0) return false
          for (const n of nums) {
            const v = Number(n)
            if (!Number.isFinite(v) || v < -700 || v > NIGHT_W + 700 || v > NIGHT_H + 1200) return false
          }
        }
        return true
      }),
      { numRuns: 60 },
    )
  })
  it('different seeds give different trees', () => {
    expect(JSON.stringify(branchPaths(1))).not.toBe(JSON.stringify(branchPaths(2)))
  })
  it('does not use Math.random', () => {
    expect(readFileSync('src/steam/branches.ts', 'utf8')).not.toMatch(/Math\.random/)
  })
  it('keeps the moon the night view draws (R23.3)', () => {
    expect(MOON_CENTRE).toEqual(MOON)
  })
  it('no branch comes within 0.45 of the moon radius from the disc centre, for any seed (R23.3)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        for (const l of branchPaths(seed)) {
          const nums = (l.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
          for (let i = 0; i + 1 < nums.length; i += 2) {
            if (Math.hypot(nums[i] - MOON.x, nums[i + 1] - MOON.y) < MOON.r * 0.45) return false
          }
        }
        return true
      }),
      { numRuns: 80 },
    )
    expect(KEEP_R).toBeGreaterThan(MOON.r * 0.45)
  })
  it('draws tapered shapes: closed polygons whose width falls along the limb, thinner at deeper levels (R23.3)', () => {
    const layers = branchPaths(1750)
    expect(layers.every((l) => l.d.includes('Z'))).toBe(true)
    for (let i = 1; i < layers.length; i++) expect(layers[i].w).toBeLessThan(layers[i - 1].w)
    // the first polygon of the first layer: base wider than tip
    const first = layers[0].d.split('Z')[0].slice(1).split('L').map((p) => p.split(' ').map(Number))
    const half = first.length / 2
    const gap = (i: number): number => Math.hypot(first[i][0] - first[first.length - 1 - i][0], first[i][1] - first[first.length - 1 - i][1])
    expect(gap(0)).toBeGreaterThan(gap(half - 1) * 1.15)
  })
  it('crooked: the limbs are not straight lines', () => {
    const first = branchPaths(1750)[0].d.split('Z')[0].slice(1).split('L').map((p) => p.split(' ').map(Number))
    const half = first.length / 2
    const a = first[0]
    const b = first[half - 1]
    let maxOff = 0
    for (let i = 1; i < half - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - first[i][1]) - (a[0] - first[i][0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1])
      maxOff = Math.max(maxOff, d)
    }
    expect(maxOff).toBeGreaterThan(1.5)
  })
})
