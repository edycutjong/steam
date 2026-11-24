import { describe, expect, it } from 'vitest'
import { parseParams } from './params.ts'
import { LEAD_MS } from './timeline.ts'

describe('parseParams', () => {
  it('defaults', () => {
    expect(parseParams('', '')).toEqual({ t: null, lead: LEAD_MS, fps: false })
  })
  it('reads t, lead and fps from search', () => {
    expect(parseParams('?t=5100', '').t).toBe(5100)
    expect(parseParams('?lead=400', '').lead).toBe(400)
    expect(parseParams('?fps=1', '').fps).toBe(true)
  })
  it('accepts a negative t and zero lead', () => {
    expect(parseParams('?t=-1500', '').t).toBe(-1500)
    expect(parseParams('?lead=0', '').lead).toBe(0)
  })
  it('ignores bad values', () => {
    expect(parseParams('?t=abc&lead=-5&fps=2', '')).toEqual({ t: null, lead: LEAD_MS, fps: false })
    expect(parseParams('?t=&lead=&fps=', '')).toEqual({ t: null, lead: LEAD_MS, fps: false })
    expect(parseParams('?t=Infinity&lead=NaN', '')).toEqual({ t: null, lead: LEAD_MS, fps: false })
  })
  it('reads the hash route query', () => {
    expect(parseParams('', '#/?t=9000&fps=1')).toEqual({ t: 9000, lead: LEAD_MS, fps: true })
    expect(parseParams('', '#/')).toEqual({ t: null, lead: LEAD_MS, fps: false })
  })
  it('search wins over hash', () => {
    expect(parseParams('?t=1', '#/?t=2').t).toBe(1)
  })
  it('falls back to the hash when the search value is bad', () => {
    expect(parseParams('?t=x', '#/?t=2').t).toBe(2)
  })
  it('t overrides lead', () => {
    expect(parseParams('?t=100&lead=50', '').lead).toBe(LEAD_MS)
  })
})
