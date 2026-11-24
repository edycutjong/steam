import fc from 'fast-check'
import { describe, it } from 'vitest'
import { PHASE_ORDER, WRITE_ON_MS, revealState } from './timeline.ts'

const anyDouble = fc.double({ noNaN: false })
const wipeArb = fc.oneof(fc.constant(null), anyDouble)
const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e7, max: 1e7 })

describe('revealState properties', () => {
  it('A: every state is valid', () => {
    fc.assert(
      fc.property(anyDouble, wipeArb, (t, w) => {
        const s = revealState(t, w)
        const unit = [s.thicken, s.head, s.wipe, s.refog]
        return (
          s.u >= -1 && s.u <= 1 && unit.every((x) => x >= 0 && x <= 1) && PHASE_ORDER.includes(s.phase)
        )
      }),
    )
  })

  it('B: u, wipe and phase never decrease over time', () => {
    fc.assert(
      fc.property(finite, finite, fc.oneof(fc.constant(null), finite), (a, b, w) => {
        const [t1, t2] = a <= b ? [a, b] : [b, a]
        const s1 = revealState(t1, w)
        const s2 = revealState(t2, w)
        return (
          s2.u >= s1.u &&
          s2.wipe >= s1.wipe &&
          PHASE_ORDER.indexOf(s2.phase) >= PHASE_ORDER.indexOf(s1.phase)
        )
      }),
    )
  })

  it('C: after the write-on, u is always 1', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: WRITE_ON_MS, max: 1e9 }), wipeArb, (t, w) => {
        return revealState(t, w).u === 1
      }),
    )
  })
})
