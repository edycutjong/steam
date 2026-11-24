// Component partition (requirements R19.8 to R19.12, design 3.5 "Component-partition boundary"): the order of a line's
// owned components, the ranked candidates, the groups, and the tie rule. Written before the implementation.
import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { assignGroups, lineComponents, partitionCandidates, type PartComponent } from './partition.ts'

const W = 120
const H = 40

/** Rectangles of ink (x0, y0, x1, y1 inclusive); all owned by line 0. */
function scene(rects: [number, number, number, number][]) {
  const ink = new Uint8Array(W * H)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink[y * W + x] = 1
  const labels = labelComponents(ink, W, H)
  const owner = new Int16Array(W * H).fill(-1)
  for (let i = 0; i < ink.length; i++) if (ink[i]) owner[i] = 0
  return { ink, labels, owner, id: (x: number, y: number) => labels.label[y * W + x]! }
}
const order = (s: ReturnType<typeof scene>, extent: [number, number] = [0, W - 1], slant = 0): PartComponent[] => lineComponents(s.labels, s.owner, 0, 20, slant, extent)

describe('lineComponents: the order', () => {
  it('sorts the owned components by centroid column, left to right', () => {
    const s = scene([[60, 10, 64, 30], [10, 10, 14, 30], [35, 10, 39, 30]])
    expect(order(s).map((c) => c.id)).toEqual([s.id(10, 10), s.id(35, 10), s.id(60, 10)])
    expect(order(s).map((c) => c.cx)).toEqual([12, 37, 62])
  })

  it('breaks an exact tie of centroids by component id', () => {
    // a ring-like pair: two components with the same centroid column 20 (a thin bar and a wide bar one above the other)
    const s = scene([[18, 5, 22, 6], [10, 12, 30, 13]])
    const o = order(s)
    expect(o[0]!.cx).toBe(o[1]!.cx)
    expect(o.map((c) => c.id)).toEqual([...o.map((c) => c.id)].sort((a, b) => a - b))
  })

  it('takes the centroid in slant-corrected columns: x - s (yMid - y)', () => {
    // a stroke leaning right with s = 0.5: its centroid column in x' is the column of its middle row
    const ink = new Uint8Array(W * H)
    for (let y = 10; y <= 30; y++) ink[y * W + 50 + Math.round((20 - y) / 2)] = 1
    const labels = labelComponents(ink, W, H)
    const owner = new Int16Array(W * H).fill(-1)
    for (let i = 0; i < ink.length; i++) if (ink[i]) owner[i] = 0
    const [c] = lineComponents(labels, owner, 0, 20, 0.5, [0, W - 1])
    expect(c!.cx).toBeCloseTo(50, 0)
    expect(c!.last - c!.first).toBeLessThanOrEqual(1)
  })

  it('counts only the pixels the line owns', () => {
    const s = scene([[10, 10, 14, 30]])
    const half = new Int16Array(s.owner)
    for (let y = 21; y <= 30; y++) for (let x = 10; x <= 14; x++) half[y * W + x] = 1 // the lower half belongs to line 1
    const [c] = lineComponents(s.labels, half, 0, 20, 0, [0, W - 1])
    expect(c!.px).toBe(5 * 11)
    expect(lineComponents(s.labels, half, 1, 20, 0, [0, W - 1])[0]!.px).toBe(5 * 10)
  })

  it('leaves out a component whose centroid is outside the text extent (a margin speck is in no word)', () => {
    const s = scene([[2, 10, 3, 11], [30, 10, 34, 30], [60, 10, 64, 30]])
    expect(order(s, [20, 80]).map((c) => c.id)).toEqual([s.id(30, 10), s.id(60, 10)])
  })

  it('gives a component ink only when it is writing (30 px or more), counted inside the extent', () => {
    const s = scene([[10, 10, 11, 12], [30, 10, 34, 30]])
    const o = order(s)
    expect(o[0]!.ink).toBe(0) // a 6 px speck
    expect(o[1]!.ink).toBe(5 * 21)
  })
})

describe('partitionCandidates', () => {
  it('lists the gaps between consecutive components, ranked by the empty columns between the two groups', () => {
    // components at columns 10-14, 20-24 (gap 5), 50-54 (gap 25), 60-64 (gap 5), 100-104 (gap 35)
    const s = scene([[10, 10, 14, 30], [20, 10, 24, 30], [50, 10, 54, 30], [60, 10, 64, 30], [100, 10, 104, 30]])
    const c = partitionCandidates(order(s))
    expect(c).toHaveLength(4)
    expect(c.map((x) => x.gap)).toEqual([35, 25, 5, 5])
    expect(c.map((x) => x.rank)).toEqual([0, 1, 2, 3])
    // ties: left first
    expect(c.map((x) => x.position)).toEqual([3, 1, 0, 2])
    expect(c[0]).toMatchObject({ after: s.id(60, 10), before: s.id(100, 10) })
  })

  it('uses the whole group on each side, so an overlap behind a long stroke gives a negative gap', () => {
    // A (10-14), a long bar B (12-70, centroid 41) and C (45-49, centroid 47): after the bar the left group reaches column 70
    const s = scene([[10, 10, 14, 30], [12, 5, 70, 6], [45, 10, 49, 30]])
    const o = order(s)
    expect(o.map((c) => c.id)).toEqual([s.id(10, 10), s.id(12, 5), s.id(45, 10)])
    const c = partitionCandidates(o)
    const afterBar = c.find((x) => x.after === s.id(12, 5))!
    expect(afterBar.gap).toBe(45 - 70 - 1)
    const afterA = c.find((x) => x.after === s.id(10, 10))!
    expect(afterA.gap).toBe(12 - 14 - 1)
    expect(c[0]).toBe(afterA) // the less negative gap ranks first
  })

  it('is empty for fewer than two components', () => {
    expect(partitionCandidates([])).toEqual([])
    expect(partitionCandidates(order(scene([[10, 10, 14, 30]])))).toEqual([])
  })

  it('reads gaps from the owned pixels in slanted columns', () => {
    // two strokes leaning right (s = 0.5) that overlap in plain columns but not in sheared ones
    const ink = new Uint8Array(W * H)
    const lean = (x0: number) => {
      for (let y = 10; y <= 30; y++) ink[y * W + x0 + Math.round((20 - y) / 2)] = 1
    }
    lean(40)
    lean(54)
    const labels = labelComponents(ink, W, H)
    const owner = new Int16Array(W * H).fill(-1)
    for (let i = 0; i < ink.length; i++) if (ink[i]) owner[i] = 0
    const c = partitionCandidates(lineComponents(labels, owner, 0, 20, 0.5, [0, W - 1]))
    expect(c).toHaveLength(1)
    expect(c[0]!.gap).toBeGreaterThanOrEqual(11)
  })
})

describe('assignGroups and the tie rule (R19.12)', () => {
  it('puts every component up to and including the named one on the left, the others on the right', () => {
    const s = scene([[10, 10, 14, 30], [20, 10, 24, 30], [50, 10, 54, 30], [60, 10, 64, 30]])
    const o = order(s)
    const g = assignGroups(o, [s.id(20, 10)])
    expect([...g.entries()]).toEqual([[s.id(10, 10), 0], [s.id(20, 10), 0], [s.id(50, 10), 1], [s.id(60, 10), 1]])
  })

  it('with two boundaries makes three groups in order', () => {
    const s = scene([[10, 10, 14, 30], [20, 10, 24, 30], [50, 10, 54, 30], [60, 10, 64, 30]])
    const g = assignGroups(order(s), [s.id(10, 10), s.id(50, 10)])
    expect([...g.values()]).toEqual([0, 1, 1, 2])
  })

  it('rejects a boundary that is not a component of the line, one that is last, and boundaries out of order', () => {
    const s = scene([[10, 10, 14, 30], [20, 10, 24, 30], [50, 10, 54, 30]])
    const o = order(s)
    expect(() => assignGroups(o, [999])).toThrow(/not a candidate/)
    expect(() => assignGroups(o, [s.id(50, 10)])).toThrow(/not a candidate/)
    expect(() => assignGroups(o, [s.id(20, 10), s.id(10, 10)])).toThrow(/left to right/)
  })

  it('tie rule: a long t-cross of the left word whose centroid lies inside the right word goes with the right word, whole', () => {
    // "it" = stem at 10-12; "till" = stems at 40-42 and 55-57; the t-cross of "it" is a bar from 20 to 70 (centroid 45) inside "till"
    const s = scene([[10, 10, 12, 30], [40, 10, 42, 30], [20, 5, 70, 6], [55, 10, 57, 30]])
    const o = order(s)
    expect(o.map((c) => c.id)).toEqual([s.id(10, 10), s.id(40, 10), s.id(20, 5), s.id(55, 10)])
    const g = assignGroups(o, [s.id(10, 10)])
    expect(g.get(s.id(20, 5))).toBe(1) // with the neighbour, by its centroid, never moved
    expect(g.get(s.id(10, 10))).toBe(0)
    // and not a single pixel of the bar is split: the group is a property of the component
    const groupsOfBarPixels = new Set<number>()
    for (let x = 20; x <= 70; x++) for (const y of [5, 6]) groupsOfBarPixels.add(g.get(s.labels.label[y * W + x]!)!)
    expect([...groupsOfBarPixels]).toEqual([1])
  })

  it('tie rule: equal centroids are ordered by id, the smaller id first', () => {
    const s = scene([[18, 5, 22, 6], [10, 12, 30, 13], [60, 10, 64, 30]])
    const o = order(s)
    const ids = o.slice(0, 2).map((c) => c.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    const g = assignGroups(o, [ids[0]!])
    expect(g.get(ids[0]!)).toBe(0)
    expect(g.get(ids[1]!)).toBe(1)
  })
})
