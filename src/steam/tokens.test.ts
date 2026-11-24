import { describe, expect, it } from 'vitest'
import { parseColor } from './tokens.ts'

describe('parseColor', () => {
  it('parses #RRGGBB', () => {
    const [r, g, b] = parseColor('#EFE7DA')
    expect(r).toBeCloseTo(0xef / 255, 6)
    expect(g).toBeCloseTo(0xe7 / 255, 6)
    expect(b).toBeCloseTo(0xda / 255, 6)
  })
  it('parses with surrounding whitespace and lower case', () => {
    expect(parseColor(' #0e0a0a ')).toEqual(parseColor('#0E0A0A'))
  })
  it('parses #RGB', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1])
  })
  it('parses rgb() with commas or spaces', () => {
    expect(parseColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2])
    expect(parseColor('rgb(255 0 51)')).toEqual([1, 0, 0.2])
  })
  it('rejects empty and malformed values', () => {
    for (const bad of ['', '   ', 'red', '#12', '#gggggg', 'rgb(300, 0, 0)', 'rgb(1,2)']) {
      expect(() => parseColor(bad)).toThrow()
    }
  })
})
