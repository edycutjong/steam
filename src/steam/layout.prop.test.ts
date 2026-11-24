import fc from 'fast-check'
import { describe, it } from 'vitest'
import { MIN_CORE_CSS_PX, chooseLayout, computeLayout, type LayoutMeta } from './layout.ts'

const meta: LayoutMeta = {
  size: [1251, 177],
  groups: [
    { rect: [781, 32, 1219, 93], coreBand: [46, 81], t: [0, 0.485] },
    { rect: [31, 85, 496, 145], coreBand: [109, 143], t: [0.485, 1] },
  ],
}

describe('computeLayout properties', () => {
  it('is finite, stays inside the note, and keeps the phone core band', () => {
    fc.assert(
      fc.property(fc.integer({ min: 320, max: 2560 }), fc.integer({ min: 400, max: 1600 }), (w, h) => {
        const l = computeLayout(chooseLayout(w), w, h, meta)
        return l.groups.every((g) => {
          const nums = [...g.src, ...g.dst, ...g.inked, g.scale, g.coreBandCssPx]
          return (
            nums.every(Number.isFinite) &&
            g.src[0] >= 0 &&
            g.src[1] >= 0 &&
            g.src[2] <= meta.size[0] &&
            g.src[3] <= meta.size[1] &&
            g.src[2] > g.src[0] &&
            g.src[3] > g.src[1] &&
            g.scale > 0 &&
            (l.kind !== 'groups' || g.coreBandCssPx >= MIN_CORE_CSS_PX - 1e-9)
          )
        })
      }),
    )
  })
})
