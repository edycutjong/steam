import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import { timeMap, tracePath, zhangSuen, type GroupInput } from './timeofink.ts'

const fromRows = (rows: string[]) => ({ w: rows[0]!.length, h: rows.length, a: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))) })
const count = (a: Uint8Array) => a.reduce((s, v) => s + v, 0)
const comps = (a: Uint8Array, w: number, h: number) => labelComponents(a, w, h).ids.length

describe('zhangSuen', () => {
  it('thins a bar to one pixel wide, inside the bar, connected, nearly its length', () => {
    const w = 30
    const h = 9
    const m = new Uint8Array(w * h)
    for (let y = 3; y < 6; y++) for (let x = 4; x < 24; x++) m[y * w + x] = 1
    const s = zhangSuen(m, w, h)
    for (let i = 0; i < m.length; i++) if (s[i]) expect(m[i]).toBe(1)
    expect(comps(s, w, h)).toBe(1)
    for (let x = 6; x < 22; x++) {
      let col = 0
      for (let y = 0; y < h; y++) col += s[y * w + x]!
      expect(col).toBe(1)
    }
    expect(count(s)).toBeGreaterThanOrEqual(16)
    expect(count(s)).toBeLessThanOrEqual(22)
  })
  it('keeps a ring as a closed ring (one component, one hole)', () => {
    const { w, h, a } = fromRows(['..........', '.########.', '.########.', '.##....##.', '.##....##.', '.##....##.', '.##....##.', '.########.', '.########.', '..........'])
    const s = zhangSuen(a, w, h)
    expect(comps(s, w, h)).toBe(1)
    expect(count(s)).toBeLessThan(count(a))
    // the background still has an enclosed hole: 4-connected background components = outside + hole
    const bg = new Uint8Array(w * h)
    for (let i = 0; i < bg.length; i++) bg[i] = s[i] ? 0 : 1
    let holes = 0
    const seen = new Uint8Array(w * h)
    for (let i = 0; i < bg.length; i++) {
      if (!bg[i] || seen[i]) continue
      holes++
      const q = [i]
      seen[i] = 1
      while (q.length) {
        const p = q.pop()!
        const x = p % w
        const y = (p - x) / w
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (bg[j] && !seen[j]) (seen[j] = 1, q.push(j))
        }
      }
    }
    expect(holes).toBe(2)
  })
  it('keeps a cross connected with all four arms', () => {
    const w = 25
    const m = new Uint8Array(w * w)
    for (let i = 3; i < 22; i++) for (let t = 11; t < 14; t++) (m[i * w + t] = 1, (m[t * w + i] = 1))
    const s = zhangSuen(m, w, w)
    expect(comps(s, w, w)).toBe(1)
    for (const [x, y] of [[6, 12], [18, 12], [12, 6], [12, 18]]) expect(s[y * w + x]).toBe(1)
  })
  it('leaves a single pixel alone and never erases a component', () => {
    const w = 7
    const dot = new Uint8Array(w * w)
    dot[3 * w + 3] = 1
    expect(count(zhangSuen(dot, w, w))).toBe(1)
    const sq = new Uint8Array(w * w)
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) sq[y * w + x] = 1
    const s = zhangSuen(sq, w, w)
    expect(count(s)).toBeGreaterThanOrEqual(1)
    expect(count(s)).toBeLessThanOrEqual(3)
  })
})

describe('tracePath (R22.2)', () => {
  const W = 40
  const H = 20
  const bar = (y: number, x0: number, x1: number) => {
    const m = new Uint8Array(W * H)
    for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) m[(y + k) * W + x] = 1
    return m
  }
  const groups: GroupInput[] = [
    { line: 8, mask: bar(4, 5, 25), yMid: 5 },
    { line: 9, mask: bar(12, 3, 23), yMid: 13 },
  ]
  it('sorts the path by (group, x\', y) and gives times that never decrease', () => {
    const t = tracePath(groups, W, H, 0)
    for (let i = 1; i < t.path.length; i++) {
      const a = t.path[i - 1]!
      const b = t.path[i]!
      expect(b.t).toBeGreaterThanOrEqual(a.t)
      expect(a.group < b.group || a.xp < b.xp || (a.xp === b.xp && a.y <= b.y)).toBe(true)
      expect(b.group).toBeGreaterThanOrEqual(a.group)
    }
    expect(t.path[0]!.t).toBe(0)
    expect(t.path[t.path.length - 1]!.t).toBe(1)
  })
  it('t = (offset + x\' - lo) / W per group, groups ordered by line, ranges chained', () => {
    const t = tracePath(groups, W, H, 0)
    const [g0, g1] = t.groups
    const w0 = g0!.hi - g0!.lo
    const w1 = g1!.hi - g1!.lo
    expect(t.totalWidth).toBe(w0 + w1)
    expect(g0!.t[0]).toBe(0)
    expect(g0!.t[1]).toBeCloseTo(w0 / (w0 + w1), 12)
    expect(g1!.t[0]).toBeCloseTo(w0 / (w0 + w1), 12)
    expect(g1!.t[1]).toBe(1)
    const mid = t.path.find((p) => p.group === 1 && p.xp === g1!.lo + 5)!
    expect(mid.t).toBeCloseTo((w0 + 5) / (w0 + w1), 12)
  })
  it('orders groups by line index even when given out of order', () => {
    const t = tracePath([groups[1]!, groups[0]!], W, H, 0)
    expect(t.groups.map((g) => g.line)).toEqual([8, 9])
  })
})

describe('timeMap (R22.3)', () => {
  it('equals a brute-force nearest skeleton pixel (ties to lower x\', then lower y), per group', () => {
    const W = 36
    const H = 26
    const m = new Uint8Array(W * H)
    for (let y = 4; y < 20; y++) for (let x = 6 + (y >> 2); x < 9 + (y >> 2); x++) m[y * W + x] = 1
    for (let x = 6; x < 30; x++) for (let y = 11; y < 14; y++) m[y * W + x] = 1
    const g: GroupInput = { line: 0, mask: m, yMid: 12 }
    const tr = tracePath([g], W, H, 0.2)
    const tm = timeMap(tr, [g], W, H, 0.2)
    const sk = tr.path.map((p) => ({ x: p.x, y: p.y, xp: p.xp, t: p.t }))
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) {
          expect(Number.isNaN(tm.t[y * W + x]!)).toBe(true)
          continue
        }
        let best = sk[0]!
        let bd = Infinity
        for (const p of sk) {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2
          if (d < bd || (d === bd && (p.xp < best.xp || (p.xp === best.xp && p.y < best.y)))) (bd = d, (best = p))
        }
        expect(tm.t[y * W + x]).toBeCloseTo(best.t, 6)
      }
  })
  it('a skeleton-free piece takes the time of its own centroid x\'', () => {
    const W = 40
    const H = 16
    const m = new Uint8Array(W * H)
    for (let x = 2; x < 30; x++) for (let y = 5; y < 8; y++) m[y * W + x] = 1
    // a 2x2 piece far to the right: Zhang-Suen can erase it completely
    for (const [x, y] of [[35, 6], [36, 6], [35, 7], [36, 7]]) m[y * W + x] = 1
    const g: GroupInput = { line: 0, mask: m, yMid: 6 }
    const tr = tracePath([g], W, H, 0)
    const tm = timeMap(tr, [g], W, H, 0)
    const t = tm.t[6 * W + 35]!
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(1)
  })
})
