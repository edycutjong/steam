import fc from 'fast-check'
import { describe, it } from 'vitest'
import { HEAD_BINS, derive } from './derive.ts'

describe('derive properties', () => {
  it('always returns exact sizes and finite, in-range values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 1, max: 14 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (w, h, stream) => {
          const it = stream[Symbol.iterator]()
          const toi = new Uint8ClampedArray(w * h * 4)
          const note = new Uint8ClampedArray(w * h * 4)
          for (let i = 0; i < w * h * 4; i++) {
            const v = it.next().value as number
            // sparse ink: most R values are 0
            toi[i] = i % 4 === 0 ? (v > 200 ? v : 0) : v
            note[i] = (it.next().value as number)
          }
          const d = derive({ data: toi, width: w, height: h }, { data: note, width: w, height: h })
          return (
            d.chan.length === w * h * 4 &&
            d.head.length === HEAD_BINS * 2 &&
            Array.from(d.chan).every((v) => v >= 0 && v <= 255 && Number.isInteger(v)) &&
            Array.from(d.head).every(Number.isFinite)
          )
        },
      ),
    )
  })
})
