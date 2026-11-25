import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NIGHT_H, NIGHT_W, branchPaths } from './branches.ts'

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
})
