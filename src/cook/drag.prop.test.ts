import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dedupe, dragThreshold, dragWipe, type Sample } from './drag.ts'

// K9 (design 13): the drag recognizer.
const path = fc.array(fc.tuple(fc.integer({ min: -60, max: 160 }), fc.integer({ min: -400, max: 400 }), fc.integer({ min: 0, max: 400 })), { minLength: 0, maxLength: 40 }).map((steps) => {
  let x = 0
  let y = 0
  let t = 0
  return steps.map(([dx, dy, dtm]) => ({ x: (x += dx), y: (y += dy), t: (t += dtm) }) as Sample)
})
const width = fc.integer({ min: 200, max: 1400 })

describe('K9: the drag recognizer', () => {
  it('fires exactly at the first sample where summed |dx| reaches max(96, 25% of the width) within 2 s, and never otherwise (vertical travel does not count)', () => {
    fc.assert(
      fc.property(path, width, (p, w) => {
        const need = dragThreshold(w)
        let travel = 0
        let want: number | null = null
        for (let i = 1; i < p.length && want === null; i++) {
          travel += Math.abs(p[i]!.x - p[i - 1]!.x)
          if (p[i]!.t - p[0]!.t <= 2000 && travel >= need) want = i
        }
        expect(dragWipe(p, w)).toBe(want)
      }),
      { numRuns: 1500 },
    )
  })
  it('a path with fewer than two samples never fires', () => {
    fc.assert(fc.property(path.map((p) => p.slice(0, 1)), width, (p, w) => dragWipe(p, w) === null))
  })
  it('two fires within 400 ms are collapsed to one, and kept fires are at least 400 ms apart', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 30 }).map((a) => a.sort((x, y) => x - y)), (ts) => {
        const d = dedupe(ts, 400)
        for (let i = 1; i < d.length; i++) expect(d[i]! - d[i - 1]!).toBeGreaterThanOrEqual(400)
        expect(d[0]).toBe(ts[0])
        for (const t of ts) expect(d.some((k) => k <= t && t - k < 400)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })
})
