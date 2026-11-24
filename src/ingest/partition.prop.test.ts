// Properties of the component partition (requirements R19.8 to R19.12). Written before the implementation.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { assignGroups, lineComponents, partitionCandidates } from './partition.ts'
import { shearedColumn } from './runs.ts'

const W = 160
const H = 48

/** Non-touching rectangles of ink in a row, with random size, position and slant. */
const sceneArb = fc.record({
  rects: fc.array(fc.record({ x: fc.integer({ min: 2, max: 140 }), y: fc.integer({ min: 6, max: 30 }), w: fc.integer({ min: 1, max: 40 }), h: fc.integer({ min: 1, max: 14 }) }), { minLength: 2, maxLength: 9 }),
  s: fc.constantFrom(0, 0.25, 0.5, 0.8, -0.3),
  picks: fc.array(fc.nat(), { minLength: 0, maxLength: 3 }),
})

function build(rects: { x: number; y: number; w: number; h: number }[]) {
  const ink = new Uint8Array(W * H)
  for (const r of rects) for (let y = r.y; y < Math.min(H, r.y + r.h); y++) for (let x = r.x; x < Math.min(W, r.x + r.w); x++) ink[y * W + x] = 1
  const labels = labelComponents(ink, W, H)
  const owner = new Int16Array(W * H).fill(-1)
  for (let i = 0; i < ink.length; i++) if (ink[i]) owner[i] = 0
  return { labels, owner }
}

describe('component partition properties', () => {
  it('candidates are the n-1 gaps, equal to a brute-force gap over the pixels, ranked largest first, ties left first', () => {
    fc.assert(
      fc.property(sceneArb, ({ rects, s }) => {
        const { labels, owner } = build(rects)
        const order = lineComponents(labels, owner, 0, 20, s, [-1000, 1000])
        const cands = partitionCandidates(order)
        expect(cands).toHaveLength(Math.max(0, order.length - 1))
        const colsOf = (id: number): number[] => {
          const out: number[] = []
          for (let i = 0; i < labels.label.length; i++) if (labels.label[i] === id) out.push(shearedColumn(i % W, Math.floor(i / W), 20, s))
          return out
        }
        for (const c of cands) {
          const left = order.slice(0, c.position + 1).flatMap((o) => colsOf(o.id))
          const right = order.slice(c.position + 1).flatMap((o) => colsOf(o.id))
          expect(c.gap).toBe(Math.min(...right) - Math.max(...left) - 1)
          expect(c.after).toBe(order[c.position]!.id)
          expect(c.before).toBe(order[c.position + 1]!.id)
        }
        for (let k = 1; k < cands.length; k++) {
          const a = cands[k - 1]!
          const b = cands[k]!
          expect(a.gap > b.gap || (a.gap === b.gap && a.position < b.position)).toBe(true)
          expect(b.rank).toBe(k)
        }
      }),
      { numRuns: 120 },
    )
  })

  it('the order is by centroid, then id', () => {
    fc.assert(
      fc.property(sceneArb, ({ rects, s }) => {
        const { labels, owner } = build(rects)
        const order = lineComponents(labels, owner, 0, 20, s, [-1000, 1000])
        for (let k = 1; k < order.length; k++) {
          const a = order[k - 1]!
          const b = order[k]!
          expect(a.cx < b.cx || (a.cx === b.cx && a.id < b.id)).toBe(true)
        }
      }),
      { numRuns: 120 },
    )
  })

  it('whatever boundaries are chosen: every owned component has exactly one group, groups rise along the order, and no pixel of a component changes group', () => {
    fc.assert(
      fc.property(sceneArb, ({ rects, s, picks }) => {
        const { labels, owner } = build(rects)
        const order = lineComponents(labels, owner, 0, 20, s, [-1000, 1000])
        const cands = partitionCandidates(order)
        if (cands.length === 0) return
        const positions = [...new Set(picks.map((p) => cands[p % cands.length]!.position))].sort((a, b) => a - b)
        const g = assignGroups(order, positions.map((p) => order[p]!.id))
        expect(g.size).toBe(order.length)
        let last = 0
        for (const c of order) {
          const grp = g.get(c.id)!
          expect(grp).toBeGreaterThanOrEqual(last)
          last = grp
          expect(grp).toBe(positions.filter((p) => p < order.findIndex((o) => o.id === c.id)).length)
        }
        // pixel level: map every owned pixel through its component; each component's pixels land in one group only
        const seen = new Map<number, Set<number>>()
        for (let i = 0; i < owner.length; i++) {
          if (owner[i] !== 0) continue
          const id = labels.label[i]!
          if (!seen.has(id)) seen.set(id, new Set())
          seen.get(id)!.add(g.get(id)!)
        }
        for (const v of seen.values()) expect(v.size).toBe(1)
        expect(new Set(g.values()).size).toBe(positions.length + 1)
      }),
      { numRuns: 120 },
    )
  })
})
