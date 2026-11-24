// P6 (a) to (f): reveal time and the traced path, on random strokes thinned with the real Zhang-Suen.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Rgba } from './image.ts'
import { checkP6 } from './props.ts'
import { blank, mulberry32, stroke } from './synth.ts'
import { revealTimes, tracePath, zhangSuen, type GroupInput } from './timeofink.ts'

const W = 70
const H = 40

function randomGroups(seed: number, nGroups: number): GroupInput[] {
  const rnd = mulberry32(seed)
  const out: GroupInput[] = []
  for (let g = 0; g < nGroups; g++) {
    const c = blank(W, H)
    const strokes = 2 + Math.floor(rnd() * 6)
    for (let i = 0; i < strokes; i++) {
      const x = 3 + Math.floor(rnd() * (W - 12))
      const y = 3 + Math.floor(rnd() * (H - 10))
      const kind = rnd()
      if (kind < 0.4) stroke(c, x, y, x + Math.floor(rnd() * 5 - 2), y + 4 + Math.floor(rnd() * 20), 2)
      else if (kind < 0.7) stroke(c, x, y, x + 5 + Math.floor(rnd() * 25), y + Math.floor(rnd() * 5 - 2), 2)
      else if (kind < 0.85) {
        // loop
        for (let a = 0; a < 16; a++) stroke(c, x + 4 * Math.cos((a * Math.PI) / 8), y + 4 + 4 * Math.sin((a * Math.PI) / 8), x + 4 * Math.cos(((a + 1) * Math.PI) / 8), y + 4 + 4 * Math.sin(((a + 1) * Math.PI) / 8), 1)
      } else stroke(c, x, y, x + 1, y + 1, 2) // dot
    }
    out.push({ line: g * 2 + 1, mask: c.ink, yMid: 10 + 5 * g })
  }
  return out
}

const toiOf = (groups: GroupInput[], tr: ReturnType<typeof tracePath>, s: number): Rgba => {
  const support = new Uint8Array(W * H)
  for (const g of groups) for (let i = 0; i < support.length; i++) if (g.mask[i]) support[i] = 1
  const rt = revealTimes(tr, groups, W, H, s, support)
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    if (!support[i]) continue
    data[i * 4] = 255
    data[i * 4 + 1] = Math.round(255 * rt.t[i]!)
    data[i * 4 + 2] = 255
    data[i * 4 + 3] = 255
  }
  return { width: W, height: H, data }
}

const arb = fc.tuple(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 3 }), fc.integer({ min: -10, max: 16 }))

describe('P6 reveal time and trace', () => {
  it('(a) to (e): times in [0,1] equal to the nearest skeleton time, path monotone, coverage, ordered groups, G = round(255 t)', () => {
    fc.assert(
      fc.property(arb, ([seed, n, s20]) => {
        const s = s20 / 20
        const groups = randomGroups(seed, n)
        const tr = tracePath(groups, W, H, s)
        // (b)
        for (let i = 1; i < tr.path.length; i++) expect(tr.path[i]!.t).toBeGreaterThanOrEqual(tr.path[i - 1]!.t)
        // (c) path covers the skeleton
        const ordered = [...groups].sort((a, b) => a.line - b.line)
        let sk = 0
        ordered.forEach((g) => (sk += zhangSuen(g.mask, W, H).reduce((a, b) => a + b, 0)))
        expect(tr.path.length / Math.max(1, sk)).toBeGreaterThanOrEqual(0.95)
        // (d)
        tr.groups.forEach((g, k) => {
          expect(g.t[0]).toBeGreaterThanOrEqual(0)
          expect(g.t[0]).toBeLessThanOrEqual(g.t[1] + 1e-12)
          expect(g.t[1]).toBeLessThanOrEqual(1 + 1e-12)
          if (k > 0) expect(tr.groups[k - 1]!.t[1]).toBeLessThanOrEqual(g.t[0] + 1e-12)
        })
        // (a) every mask pixel has a finite time in [0,1]
        const toi = toiOf(groups, tr, s)
        const support = new Uint8Array(W * H)
        for (let i = 0; i < W * H; i++) support[i] = toi.data[i * 4]! > 0 ? 1 : 0
        const rt = revealTimes(tr, groups, W, H, s, support)
        for (let i = 0; i < W * H; i++) if (support[i]) expect(rt.t[i]! >= 0 && rt.t[i]! <= 1).toBe(true)
        // (e) the written G equals the quantised time, and checkP6 agrees
        const r = checkP6({ trace: tr, groups, width: W, height: H, s, toi })
        expect(r.detail).toMatch(/px timed/)
        expect(r.pass).toBe(true)
        // a one-step change of any written G is caught
        const k = toi.data.findIndex((v, i) => i % 4 === 0 && v > 0)
        if (k >= 0) {
          const bad = { ...toi, data: toi.data.slice() }
          bad.data[k + 1] = bad.data[k + 1]! === 255 ? 254 : bad.data[k + 1]! + 1
          const rb = checkP6({ trace: tr, groups, width: W, height: H, s, toi: bad })
          expect(rb.pass).toBe(false)
          expect(rb.detail).toMatch(/quantised time/)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('(f) a mirrored mask with the mirrored slant gives the reversed times; the wrong sign does not', () => {
    // 1-pixel strokes are their own skeleton under Zhang-Suen, so the check is exact
    const line = (flip: boolean) => {
      const c = blank(W, H)
      const X = (x: number) => (flip ? W - 1 - x : x)
      for (let x = 5; x < 40; x++) c.ink[20 * W + X(x)] = 1 // horizontal run
      for (let k = 0; k <= 14; k++) c.ink[(10 + k) * W + X(48 - Math.round(k * 0.5) * 0 - k)] = 1 // 45 degree diagonal, leaning right (top is right)
      return c.ink
    }
    const s = 0.5
    const a = tracePath([{ line: 0, mask: line(false), yMid: 18 }], W, H, s)
    const b = tracePath([{ line: 0, mask: line(true), yMid: 18 }], W, H, -s)
    const bWrong = tracePath([{ line: 0, mask: line(true), yMid: 18 }], W, H, s)
    const ta = revealTimes(a, [{ line: 0, mask: line(false), yMid: 18 }], W, H, s, line(false))
    const tb = revealTimes(b, [{ line: 0, mask: line(true), yMid: 18 }], W, H, -s, line(true))
    const tw = revealTimes(bWrong, [{ line: 0, mask: line(true), yMid: 18 }], W, H, s, line(true))
    let worst = 0
    let worstWrong = 0
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!line(false)[y * W + x]) continue
        const tA = ta.t[y * W + x]!
        worst = Math.max(worst, Math.abs(1 - tA - tb.t[y * W + (W - 1 - x)]!))
        worstWrong = Math.max(worstWrong, Math.abs(1 - tA - tw.t[y * W + (W - 1 - x)]!))
      }
    expect(worst).toBeLessThanOrEqual(1 / 255)
    expect(worstWrong).toBeGreaterThan(1 / 255)
  })
})
