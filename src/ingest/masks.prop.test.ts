// P3 (a) to (d) and (f): ownership of random strokes across random line bands.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { nearestBand, ownership, type Bands } from './masks.ts'
import { blank, mulberry32, stroke } from './synth.ts'

export const W = 90

/** Random disjoint core bands with one valley row strictly between neighbours. */
export function randomBands(rnd: () => number, n: number): { bands: Bands; H: number } {
  const cores: [number, number][] = []
  const valleys: number[] = []
  let y = 6 + Math.floor(rnd() * 6)
  for (let i = 0; i < n; i++) {
    const len = 6 + Math.floor(rnd() * 12)
    cores.push([y, y + len])
    y += len
    if (i + 1 < n) {
      const gap = 4 + Math.floor(rnd() * 14)
      valleys.push(y + 1 + Math.floor(rnd() * (gap - 2)))
      y += gap
    }
  }
  return { bands: { cores, valleys }, H: y + 12 }
}

export function randomInk(rnd: () => number, H: number, strokes: number) {
  const c = blank(W, H)
  for (let i = 0; i < strokes; i++) {
    const x = Math.floor(rnd() * (W - 10))
    const y = Math.floor(rnd() * H)
    const kind = rnd()
    if (kind < 0.5) stroke(c, x, y, x + Math.floor(rnd() * 8 - 4), Math.min(H - 1, y + Math.floor(rnd() * 60)), 2)
    else if (kind < 0.8) stroke(c, x, y, x + Math.floor(rnd() * 40), y + Math.floor(rnd() * 6 - 3), 2)
    else stroke(c, x, y, x + 1, y + 1, 1 + Math.floor(rnd() * 3))
  }
  return c
}

const arb = fc.record({ seed: fc.integer({ min: 1, max: 1e9 }), n: fc.integer({ min: 1, max: 4 }), strokes: fc.integer({ min: 1, max: 14 }) })

describe('P3 ownership properties', () => {
  it('(a) total on ink, empty off ink; (b) one-band components whole; (c) splits only at valley rows; (d) centroid rule', () => {
    fc.assert(
      fc.property(arb, ({ seed, n, strokes }) => {
        const rnd = mulberry32(seed)
        const { bands, H } = randomBands(rnd, n)
        const c = randomInk(rnd, H, strokes)
        const labels = labelComponents(c.ink, W, H)
        const o = ownership(labels, bands)
        for (let i = 0; i < W * H; i++) expect(o.owner[i]! >= 0).toBe(c.ink[i] === 1) // (a)
        // independent statement per component
        const byId = new Map<number, { ys: number[]; owners: number[] }>()
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const id = labels.label[y * W + x]!
            if (id < 0) continue
            const e = byId.get(id) ?? { ys: [], owners: [] }
            e.ys.push(y)
            e.owners.push(o.owner[y * W + x]!)
            byId.set(id, e)
          }
        for (const [, e] of byId) {
          const touched = new Set<number>()
          bands.cores.forEach(([a, b], i) => {
            if (e.ys.some((y) => y >= a && y <= b)) touched.add(i)
          })
          const small = e.ys.length < 30
          if (small || touched.size === 0) {
            const cy = e.ys.reduce((s, v) => s + v, 0) / e.ys.length // (d)
            const dist = (i: number) => (cy < bands.cores[i]![0] ? bands.cores[i]![0] - cy : cy > bands.cores[i]![1] ? cy - bands.cores[i]![1] : 0)
            let best = 0
            for (let i = 1; i < n; i++) if (dist(i) < dist(best)) best = i
            expect(new Set(e.owners)).toEqual(new Set([best]))
          } else if (touched.size === 1) {
            expect(new Set(e.owners)).toEqual(touched) // (b)
          } else {
            // (c): owner is one of the touched lines, non-decreasing in y, and changes only at a valley row
            const t = [...touched].sort((a, b) => a - b)
            const order = e.ys.map((y, i) => [y, e.owners[i]!] as const).sort((a, b) => a[0] - b[0])
            for (const [, ow] of order) expect(t).toContain(ow)
            for (let i = 1; i < order.length; i++) {
              const [y0, o0] = order[i - 1]!
              const [y1, o1] = order[i]!
              expect(o1).toBeGreaterThanOrEqual(o0)
              if (o1 !== o0) expect(bands.valleys.some((v) => y0 < v && y1 >= v)).toBe(true)
            }
          }
        }
      }),
      { numRuns: 150 },
    )
  })

  it('nearestBand agrees with a brute-force reference', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 0, max: 120 }), (seed, row) => {
        const { bands } = randomBands(mulberry32(seed), 4)
        let best = 0
        let bd = Infinity
        bands.cores.forEach(([a, b], i) => {
          const d = Math.max(a - row, row - b, 0)
          if (d < bd) (bd = d, (best = i))
        })
        expect(nearestBand(row, bands.cores)).toBe(best)
      }),
    )
  })
})
