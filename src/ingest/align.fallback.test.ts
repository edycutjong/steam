import { describe, expect, it } from 'vitest'
import { alignCurator, alignPart, noteAlignment } from './align.ts'
import type { Run } from './runs.ts'

const run = (index: number, x0: number, width: number): Run => ({ index, x0, x1: x0 + width - 1, width })
const runs = [run(0, 30, 5), run(1, 80, 6), run(2, 130, 5), run(3, 180, 6)]

describe('alignCurator (R19.3)', () => {
  it('selects the code-found runs named by index, sorted left to right', () => {
    const r = alignCurator(runs, 3, [3, 1])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.chosen.map((u) => u.index)).toEqual([1, 3])
  })
  it('rejects a wrong count, a duplicate, an out-of-range and a non-integer index', () => {
    for (const bad of [[1], [1, 1], [1, 4], [-1, 2], [0.5, 1]]) expect(alignCurator(runs, 3, bad).ok, JSON.stringify(bad)).toBe(false)
    expect((alignCurator(runs, 3, [1, 1]) as { detail: string }).detail).toMatch(/repeats/)
  })
})

describe('alignPart: auto, then curator, then whole lines', () => {
  const part = { line: 8, fromWord: 6, toWord: 8, tokenCount: 9, k: 9 as number | null }
  const wide = [14, 13, 12, 11, 10, 9, 8, 7].map((w, i) => run(i, 10 + i * 40, w))
  it('uses auto when the gaps are clear', () => {
    const r = alignPart({ ...part, runs: wide })
    expect(r.method).toBe('auto')
    expect(r.boundaries.length).toBe(8)
  })
  it('falls to a curator alignment when auto is ambiguous, recording the auto detail', () => {
    const r = alignPart({ ...part, k: 4, runs, curator: [0, 1, 3] })
    expect(r.method).toBe('curator')
    expect(r.autoDetail).toMatch(/ambiguous/)
  })
  it('falls to whole lines when both fail, and says why', () => {
    const r = alignPart({ ...part, k: 4, runs })
    expect(r.method).toBe('lines')
    expect(r.reason).toMatch(/alignment ambiguous/)
    const bad = alignPart({ ...part, k: 4, runs, curator: [0, 0, 1] })
    expect(bad.method).toBe('lines')
    expect(bad.reason).toMatch(/repeats/)
  })
  it('does not attempt alignment when the word count is unknown, or when the whole line is quoted', () => {
    expect(alignPart({ ...part, k: null, runs: wide }).reason).toMatch(/word count unknown/)
    const whole = alignPart({ ...part, fromWord: 0, toWord: 8, runs: wide })
    expect(whole.method).toBe('lines')
    expect(whole.boundaries).toEqual([])
  })
})

describe('noteAlignment (R19.6)', () => {
  const mk = (method: 'auto' | 'curator' | 'lines', reason?: string) => ({ line: 0, fromWord: 0, toWord: 0, method, boundaries: [], autoDetail: '', ...(reason ? { reason } : {}) })
  it('is the weakest method used and words only if every needed part was cut by words', () => {
    expect(noteAlignment([mk('auto'), mk('auto')])).toEqual({ alignment: 'auto', granularity: 'words' })
    expect(noteAlignment([mk('auto'), mk('curator')])).toEqual({ alignment: 'curator', granularity: 'words' })
    expect(noteAlignment([mk('auto'), mk('lines', 'ambiguous')])).toEqual({ alignment: 'lines', granularity: 'lines' })
    expect(noteAlignment([mk('lines', 'the whole line is quoted'), mk('auto')])).toEqual({ alignment: 'auto', granularity: 'words' })
    expect(noteAlignment([mk('lines', 'the whole line is quoted')])).toEqual({ alignment: 'lines', granularity: 'lines' })
  })
})
