// P5 on generated two-level images with noise, thin masks and background-free crops.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkP5, contrast, type ContrastCrop } from './props.ts'
import { mulberry32 } from './synth.ts'

const W = 30
const H = 24

function crop(seed: number, inkLevel: number, paperLevel: number, noise: number, ringOnly = false): ContrastCrop {
  const rnd = mulberry32(seed)
  const gray = new Uint8Array(W * H)
  const raw = new Uint8Array(W * H)
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const isInk = ringOnly ? true : (x > 8 && x < 12) || (y > 10 && y < 13 && x < 20)
      const n = Math.round((rnd() - 0.5) * 2 * noise)
      gray[i] = Math.max(0, Math.min(255, (isInk ? inkLevel : paperLevel) + n))
      raw[i] = isInk ? 1 : 0
      mask[i] = isInk ? 1 : 0
    }
  return { name: 'c', width: W, height: H, gray, raw, mask }
}
const independent = (c: ContrastCrop): number | null => {
  const ring = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let near = false
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && c.raw[(y + dy) * W + x + dx]) near = true
      ring[y * W + x] = near ? 1 : 0
    }
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.ceil(a.length / 2) - 1]!
  const bg = [...c.gray].filter((_, i) => !ring[i])
  const ink = [...c.gray].filter((_, i) => c.mask[i])
  return bg.length && ink.length ? med(bg) - med(ink) : null
}

const arb = fc.tuple(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 0, max: 200 }), fc.integer({ min: 30, max: 255 }), fc.integer({ min: 0, max: 20 }))

describe('P5 contrast', () => {
  it('equals median(background beyond 2 px of ink) minus median(mask), and passes iff >= 40', () => {
    fc.assert(
      fc.property(arb, ([seed, ink, paper, noise]) => {
        const c = crop(seed, ink, paper, noise)
        const v = contrast(c).value
        expect(v).toBe(independent(c))
        expect(checkP5([c]).pass).toBe(v !== null && v >= 40)
      }),
      { numRuns: 200 },
    )
  })
  it('is monotone: darker ink or brighter paper never turns a pass into a fail', () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: 0, max: 60 }), ([seed, ink, paper, noise], d) => {
        const a = checkP5([crop(seed, ink, paper, noise)]).pass
        const darker = checkP5([crop(seed, Math.max(0, ink - d), paper, noise)]).pass
        const brighter = checkP5([crop(seed, ink, Math.min(255, paper + d), noise)]).pass
        if (a) {
          expect(darker).toBe(true)
          expect(brighter).toBe(true)
        }
      }),
      { numRuns: 150 },
    )
  })
  it('is invariant under a permutation of pixel order and under translation of the crop', () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: 1, max: 1e9 }), ([seed, ink, paper, noise], ps) => {
        const c = crop(seed, ink, paper, noise)
        const v = contrast(c).value
        // permutation of the pixel order: medians only see multisets, so contrast over a permuted crop with a ring-free
        // layout is the same; check on the multiset form directly
        const rnd = mulberry32(ps)
        const idx = [...Array(W * H).keys()].sort(() => rnd() - 0.5)
        const bgIdx: number[] = []
        const ringFree = (i: number) => {
          const x = i % W
          const y = Math.floor(i / W)
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && c.raw[(y + dy) * W + x + dx]) return false
          return true
        }
        for (const i of idx) if (ringFree(i)) bgIdx.push(i)
        const med = (a: number[]) => {
          const s = [...a].sort((p, q) => p - q)
          return s[Math.ceil(s.length / 2) - 1]!
        }
        const permuted = bgIdx.length ? med(bgIdx.map((i) => c.gray[i]!)) - med(idx.filter((i) => c.mask[i]).map((i) => c.gray[i]!)) : null
        expect(permuted).toBe(v)
        // translation: the crop carries no page coordinate, so the same pixels cut from anywhere give the same value
        expect(contrast({ ...c, name: 'moved' }).value).toBe(v)
      }),
      { numRuns: 50 },
    )
  })
  it('a crop with no background fails with "no background" and does not throw', () => {
    const c = crop(1, 60, 220, 0, true)
    const r = checkP5([c])
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('no background')
  })
  it('the exclusion ring keeps the anti-aliased edge out of the background', () => {
    const c = crop(3, 60, 220, 0)
    for (let y = 0; y < H; y++) for (const x of [8, 12]) c.gray[y * W + x] = 100 // a grey halo next to the stroke
    expect(contrast(c).value).toBe(160)
  })
})
