import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'

const img = (rows: string[]): { ink: Uint8Array; w: number; h: number } => ({
  ink: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))),
  w: rows[0]!.length,
  h: rows.length,
})

/** Reference: breadth-first flood fill, component id = smallest raster index of its pixels. */
function reference(ink: Uint8Array, w: number, h: number): Int32Array {
  const out = new Int32Array(w * h).fill(-1)
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || out[i] !== -1) continue
    const q = [i]
    out[i] = i
    while (q.length) {
      const p = q.pop()!
      const px = p % w
      const py = (p - px) / w
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx
          const y = py + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const j = y * w + x
          if (ink[j] && out[j] === -1) {
            out[j] = i
            q.push(j)
          }
        }
    }
  }
  return out
}

describe('labelComponents', () => {
  it('joins diagonal neighbours (8-connectivity)', () => {
    const { ink, w, h } = img(['#..', '.#.', '..#'])
    const l = labelComponents(ink, w, h)
    expect(l.ids.length).toBe(1)
    expect(l.label[8]).toBe(0)
  })
  it('does not join pixels two apart', () => {
    const { ink, w, h } = img(['#.#'])
    expect(labelComponents(ink, w, h).ids.length).toBe(2)
  })
  it('gives each component the y*width+x of its first raster pixel', () => {
    const { ink, w, h } = img(['..#..', '.#.#.', '.....', '#...#'])
    const l = labelComponents(ink, w, h)
    expect([...l.ids]).toEqual([2, 15, 19])
    expect(l.label[6]).toBe(2)
    expect(l.label[0]).toBe(-1)
  })
  it('ids are the same for a U shape whose arms are met from the bottom (merge order does not matter)', () => {
    const { ink, w, h } = img(['#...#', '#...#', '#####'])
    const l = labelComponents(ink, w, h)
    expect([...l.ids]).toEqual([0])
    expect(l.label[4]).toBe(0)
  })
  it('sizes sum to the ink count', () => {
    const { ink, w, h } = img(['##.#', '...#', '#...'])
    const l = labelComponents(ink, w, h)
    let total = 0
    for (const id of l.ids) total += l.size.get(id)!
    expect(total).toBe(ink.reduce((a, b) => a + b, 0))
    expect(l.size.get(0)).toBe(2)
  })
})

describe('labelComponents (property)', () => {
  it('matches a flood fill on random binary images: one id per ink pixel, same partition, same ids', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 1, max: 14 }),
        fc.infiniteStream(fc.boolean()),
        (w, h, bits) => {
          const it = bits[Symbol.iterator]()
          const ink = new Uint8Array(w * h)
          for (let i = 0; i < ink.length; i++) ink[i] = it.next().value ? 1 : 0
          const l = labelComponents(ink, w, h)
          const ref = reference(ink, w, h)
          expect([...l.label]).toEqual([...ref])
          const distinct = new Set([...ref].filter((v) => v >= 0))
          expect(l.ids.length).toBe(distinct.size)
        },
      ),
      { numRuns: 200 },
    )
  })
})
