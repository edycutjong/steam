// P2 on generated pages and masks, and the margin property of buildNote's page box.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkP2, maskBox } from './props.ts'

describe('P2 inside the page', () => {
  it('passes iff mask, pageBox and PNG size are consistent, for masks near the edges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: 20, max: 80 }),
        fc.array(fc.tuple(fc.integer({ min: -3, max: 82 }), fc.integer({ min: -3, max: 82 })), { minLength: 0, maxLength: 12 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: -1, max: 1 }),
        fc.integer({ min: -1, max: 1 }),
        (W, H, pts, margin, shift, dsize) => {
          const xs = pts.map((p) => p[0])
          const ys = pts.map((p) => p[1])
          const mb: [number, number, number, number] | null = pts.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1] : null
          const pageBox: [number, number, number, number] = mb
            ? [Math.max(0, mb[0] - margin) + shift, Math.max(0, mb[1] - margin), Math.min(W, mb[2] + margin), Math.min(H, mb[3] + margin)]
            : [0, 0, 1, 1]
          const png: [number, number] = [pageBox[2] - pageBox[0] + dsize, pageBox[3] - pageBox[1]]
          const r = checkP2({ width: W, height: H }, [{ id: 'n', maskBox: mb, pageBox, png }])
          const inside = (b: number[]) => b[0]! >= 0 && b[1]! >= 0 && b[2]! <= W && b[3]! <= H && b[0]! < b[2]! && b[1]! < b[3]!
          const expected = mb !== null && inside(mb) && inside(pageBox) && mb[0] >= pageBox[0] && mb[1] >= pageBox[1] && mb[2] <= pageBox[2] && mb[3] <= pageBox[3] && png[0] === pageBox[2] - pageBox[0] && png[1] === pageBox[3] - pageBox[1]
          expect(r.pass).toBe(expected)
          if (!r.pass) expect(r.detail).toContain('n:')
        },
      ),
      { numRuns: 400 },
    )
  })
  it('maskBox is the half-open bounding box, null when empty, and the clipped margin never leaves the page', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 60 }), fc.integer({ min: 10, max: 60 }), fc.array(fc.tuple(fc.nat(59), fc.nat(59)), { minLength: 1, maxLength: 10 }), (W, H, pts) => {
        const m = new Uint8Array(W * H)
        for (const [x, y] of pts) if (x < W && y < H) m[y * W + x] = 1
        const b = maskBox(m, W, H)
        if (!b) return
        const pb: [number, number, number, number] = [Math.max(0, b[0] - 32), Math.max(0, b[1] - 32), Math.min(W, b[2] + 32), Math.min(H, b[3] + 32)]
        expect(checkP2({ width: W, height: H }, [{ id: 'n', maskBox: b, pageBox: pb, png: [pb[2] - pb[0], pb[3] - pb[1]] }]).pass).toBe(true)
      }),
    )
    expect(maskBox(new Uint8Array(9), 3, 3)).toBeNull()
  })
})
