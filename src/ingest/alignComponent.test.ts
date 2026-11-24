// Component-partition boundary in alignment (requirements R19.10, R19.11, R19.13, R19.15). Written before the implementation.
import { describe, expect, it } from 'vitest'
import { alignPart, type PartInput } from './align.ts'
import { WORD_SHAPE_RATIO_MAX } from './constants.ts'
import type { PartComponent } from './partition.ts'
import { Alignment } from '../data/schema.ts'

// A line of nine words, the hero's line 9: "to the Quinces, & boil it till it Looks" (30 characters).
const TOKENS = ['to', 'the', 'Quinces,', '&', 'boil', 'it', 'till', 'it', 'Looks']
const comp = (id: number, cx: number, ink: number): PartComponent => ({ id, cx, first: cx - 2, last: cx + 2, px: ink, ink })
/** Six components for the first six words (600 ink px in all) and three for the last three (400): 63% and 37% of the ink. */
const order = (rightInk = [200, 100, 100]): PartComponent[] => [
  comp(11, 20, 100), comp(12, 60, 100), comp(13, 110, 100), comp(14, 150, 100), comp(15, 190, 100), comp(16, 230, 100),
  comp(21, 300, rightInk[0]!), comp(22, 340, rightInk[1]!), comp(23, 380, rightInk[2]!),
]
const nulls = (n: number): null[] => new Array<null>(n).fill(null)
const entries = (at: Record<number, number>): (number | null | { kind: 'component'; after: number })[] =>
  nulls(8).map((_, g) => (g in at ? { kind: 'component' as const, after: at[g]! } : null))

function part(over: Partial<PartInput> & { curator: PartInput['curator'] }): ReturnType<typeof alignPart> {
  return alignPart({ line: 9, fromWord: 6, toWord: 8, tokenCount: 9, k: 9, runs: [], tokens: TOKENS, partition: order(), ...over })
}

describe('component boundary: a valid partition', () => {
  const r = part({ curator: entries({ 5: 16 }) })
  it('is a curator alignment cut by components', () => {
    expect(r.method).toBe('curator')
    expect(r.boundary).toBe('component')
    expect(r.boundaries).toEqual([])
    expect(r.reason).toBeUndefined()
  })
  it('records the chosen components and the components of the quoted group, nothing else', () => {
    expect(r.partition).toEqual({ after: [16], allowed: [21, 22, 23], quotedGroup: 1 })
    expect([r.fromBox, r.toBox]).toEqual([1, 1])
  })
  it('works at the right edge of a quote too, and at both edges', () => {
    const right = part({ fromWord: 0, toWord: 5, curator: entries({ 5: 16 }) })
    expect(right.method).toBe('curator')
    expect(right.partition).toEqual({ after: [16], allowed: [11, 12, 13, 14, 15, 16], quotedGroup: 0 })
    const both = part({ fromWord: 3, toWord: 5, curator: entries({ 2: 12, 5: 16 }) })
    expect(both.method).toBe('curator')
    expect(both.partition).toEqual({ after: [12, 16], allowed: [13, 14, 15, 16], quotedGroup: 1 })
  })
})

describe('component boundary: rules that send the part to whole lines, with the reason', () => {
  const lines = (r: ReturnType<typeof alignPart>, re: RegExp) => {
    expect(r.method).toBe('lines')
    expect(r.reason).toMatch(re)
    expect(r.partition).toBeUndefined()
  }
  it('a component that is not a candidate (unknown id, or the last component of the line)', () => {
    lines(part({ curator: entries({ 5: 999 }) }), /alignment\.json: component 999 is not a candidate/)
    lines(part({ curator: entries({ 5: 23 }) }), /alignment\.json: component 23 is not a candidate/)
  })
  it('a boundary inside the quote: the words inside a note stay together', () => {
    lines(part({ fromWord: 5, toWord: 8, curator: entries({ 4: 15, 6: 21 }) }), /inside the quote/)
    lines(part({ fromWord: 6, toWord: 8, curator: entries({ 5: 16, 7: 22 }) }), /inside the quote/)
  })
  it('a quote edge without a boundary (the quote would start or end inside a group that joins words)', () => {
    lines(part({ fromWord: 3, toWord: 5, curator: entries({ 2: 12 }) }), /starts or ends inside a box that merges words/)
  })
  it('run entries and component entries are not mixed', () => {
    lines(part({ curator: [3, null, null, null, null, { kind: 'component', after: 16 }, null, null] }), /mix/)
  })
  it('boundaries must rise from left to right and not repeat', () => {
    lines(part({ fromWord: 3, toWord: 5, curator: entries({ 2: 16, 5: 12 }) }), /left to right/)
    lines(part({ fromWord: 3, toWord: 5, curator: entries({ 2: 12, 5: 12 }) }), /left to right|repeats/)
  })
  it('the wrong number of entries', () => {
    lines(part({ curator: [null, { kind: 'component', after: 16 }] }), /names 2 boundary runs, the line has 9 words and needs 8/)
  })
  it('the line has no components given', () => {
    lines(part({ partition: undefined, curator: entries({ 5: 16 }) }), /needs the line's components/)
  })
  it('a group that holds less than the ink floor, on either side of the cut', () => {
    lines(part({ partition: order([5, 5, 5]), curator: entries({ 5: 16 }) }), /group 1 holds 15 ink px, under the floor 30/)
    const thinLeft = order().map((c) => (c.id < 20 ? { ...c, ink: 4, px: 4 } : c))
    lines(part({ partition: thinLeft, curator: entries({ 5: 16 }) }), /group 0 holds 24 ink px, under the floor 30/)
  })
  it('ink share against character share: the quoted words hold far too little or far too much of the ink', () => {
    // right group 50 of 650: share 0.077 against 0.367 of the characters, ratio 0.21
    lines(part({ partition: order([20, 15, 15]), curator: entries({ 5: 16 }) }), /ink share/)
    // right group 970 of 1570: ratio (970/1570)/(11/30) = 1.68 passes; 2400 of 3000: ratio 2.18 fails
    expect(part({ partition: order([400, 300, 270]), curator: entries({ 5: 16 }) }).method).toBe('curator')
    lines(part({ partition: order([1000, 800, 600]), curator: entries({ 5: 16 }) }), /ink share/)
  })
  it('the ink-share ratio is the frozen factor 2, exactly, either way', () => {
    expect(WORD_SHAPE_RATIO_MAX).toBe(2)
    // total ink 1000; the quoted words have 11 of the line's 30 characters: ratio = (right / 1000) / (11 / 30)
    const mk = (right: number): PartComponent[] => [
      comp(11, 20, 1000 - right), comp(12, 60, 0), comp(13, 110, 0), comp(14, 150, 0), comp(15, 190, 0), comp(16, 230, 0),
      comp(21, 300, right - 30), comp(22, 340, 15), comp(23, 380, 15),
    ]
    expect(part({ partition: mk(733), curator: entries({ 5: 16 }) }).method).toBe('curator') // 1.9991
    expect(part({ partition: mk(734), curator: entries({ 5: 16 }) }).reason).toMatch(/ink share/) // 2.0018
    // the other way: 0.5 is allowed, a hair under is not: right 183 of 1000 -> 0.4991, 184 -> 0.5018
    expect(part({ partition: mk(184), curator: entries({ 5: 16 }) }).method).toBe('curator')
    expect(part({ partition: mk(183), curator: entries({ 5: 16 }) }).reason).toMatch(/ink share/)
  })
})

describe('Alignment schema: the component boundary (R19.10, R19.15)', () => {
  const run = { id: 'sr-07e3ef462278', stripsHash: 'e'.repeat(64) }
  const base = { segmentRun: run, method: 'curator', by: 'A. Person', rationale: 'overlap' }
  it('accepts {kind: component, after} beside run indices and null, and a per-line by', () => {
    const ok = { ...base, lines: [{ line: 9, by: 'B. Person', boundaryRuns: [null, null, { kind: 'component', after: 2765987 }, null] }, { line: 1, boundaryRuns: [2, null, 6] }] }
    expect(Alignment.safeParse(ok).success).toBe(true)
  })
  it('rejects a coordinate, an unknown kind, an extra key, a negative id and an empty by', () => {
    const bad = (e: unknown, by?: string) => Alignment.safeParse({ ...base, lines: [{ line: 9, ...(by !== undefined ? { by } : {}), boundaryRuns: [e] }] }).success
    expect(bad({ kind: 'component', after: -1 })).toBe(false)
    expect(bad({ kind: 'component', after: 1.5 })).toBe(false)
    expect(bad({ kind: 'box', after: 3 })).toBe(false)
    expect(bad({ kind: 'component', after: 3, x: 812 })).toBe(false)
    expect(bad({ kind: 'component' })).toBe(false)
    expect(bad({ x: 812 })).toBe(false)
    expect(bad(null, '')).toBe(false)
  })
})
