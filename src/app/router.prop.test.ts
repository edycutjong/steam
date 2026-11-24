import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute, type Route } from './router.ts'

// K1 (design 13): routes round-trip.
const id = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,12}$/)
const route: fc.Arbitrary<Route> = fc.oneof(
  fc.constant<Route>({ name: 'shelf' }),
  id.map<Route>((i) => ({ name: 'edition', id: i })),
  id.map<Route>((i) => ({ name: 'quoted', id: i })),
  fc.record({ id, pace: fc.constantFrom(1 as const, 4 as const, 12 as const), note: fc.option(id, { nil: null }), lead: fc.option(fc.integer({ min: 0, max: 120000 }).map((n) => n / 1000), { nil: null }), fps: fc.boolean() }).map<Route>((r) => ({ name: 'cook', ...r })),
  fc.tuple(id, id, fc.constantFrom('', 't=2000', 'lead=0&fps=1')).map<Route>(([i, n, q]) => ({ name: 'pane', id: i, noteId: n, query: q })),
)

describe('K1: routes round-trip', () => {
  it('parseRoute(formatRoute(r)) equals r', () => {
    fc.assert(fc.property(route, (r) => { expect(parseRoute(formatRoute(r))).toEqual(r) }), { numRuns: 1000 })
  })
  it('parseRoute never throws and its result re-parses to itself, for any string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.stringMatching(/^#?\/?(r|pane)?\/?[a-z0-9-]{0,6}\/?(cook|quoted)?\??(pace|note|lead|fps)?=?[a-z0-9.-]{0,5}&?$/)), (s) => {
        const r = parseRoute(s)
        expect(parseRoute(formatRoute(r))).toEqual(r)
      }),
      { numRuns: 2000 },
    )
  })
  it('every invalid query value yields the default', () => {
    fc.assert(
      fc.property(fc.string(), (v) => {
        const r = parseRoute(`#/r/a/cook?pace=${encodeURIComponent(v)}`)
        if (r.name !== 'cook') throw new Error('not cook')
        expect(r.pace).toBe(v === '4' ? 4 : v === '12' ? 12 : 1)
      }),
      { numRuns: 500 },
    )
  })
})
