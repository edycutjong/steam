import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_FRAG,
  DROP_LARGE,
  DROP_MID,
  DROP_TINY,
  FOG_FRAG,
  REFRACT_MAX_CSS,
  STROKE_LUMA_MAX,
  STROKE_PEAK_MAX,
} from './shaders.ts'
import { parseColor } from './tokens.ts'

describe('composite constants (steam-renderer-v1 design §4, §5)', () => {
  it('clears by the continuous transmission, never by a threshold band (R1.4)', () => {
    expect(COMPOSITE_FRAG).toContain('trans(aInk)')
    expect(COMPOSITE_FRAG).toContain('inkCubic')
    expect(COMPOSITE_FRAG).not.toMatch(/CLEAR_MID|CLEAR_HALF|edgeHalf/)
  })
  it('caps stroke luminance at 92% and keeps --ink under that cap too (D14)', () => {
    expect(STROKE_LUMA_MAX).toBeLessThanOrEqual(0.92)
    const [r, g, b] = parseColor('#EFE7DA')
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(STROKE_LUMA_MAX - 0.03)
    expect(COMPOSITE_FRAG).toContain('STROKE_LUMA_MAX / max(lum')
  })
  it('caps the largest channel in a stroke, so a clipped red cannot turn the ember yellow-white (R2.4)', () => {
    expect(STROKE_PEAK_MAX).toBeLessThanOrEqual(0.92)
    expect(COMPOSITE_FRAG).toContain('STROKE_PEAK_MAX / max(peak')
  })
  it('refracts the room lookup by 1 to 3 css px (R2.2)', () => {
    expect(REFRACT_MAX_CSS).toBeGreaterThanOrEqual(1)
    expect(REFRACT_MAX_CSS).toBeLessThanOrEqual(3)
    expect(COMPOSITE_FRAG).toContain('roomLight(vUv + refr / uRes')
    expect(FOG_FRAG).toContain('oFog = vec2(')
  })
  it('draws droplets at three scales, each cell holding at most one drop of at most 0.3 cell radius (R3.2)', () => {
    const layers = [DROP_TINY, DROP_MID, DROP_LARGE]
    for (const l of layers) {
      expect(l.rHi).toBeLessThanOrEqual(0.3 * l.cell)
      expect(l.prob).toBeLessThan(1)
    }
    expect(DROP_TINY.cell).toBeLessThan(DROP_MID.cell)
    expect(DROP_MID.cell).toBeLessThan(DROP_LARGE.cell)
    expect(COMPOSITE_FRAG).toContain('uDetail > 0.5')
  })
  it('lights the room from the pot and the candle, with uniforms for both (R2.1, R6.5)', () => {
    expect(COMPOSITE_FRAG).toMatch(/uniform vec2 uPot/)
    expect(COMPOSITE_FRAG).toMatch(/uniform vec3 uCandle/)
    expect(COMPOSITE_FRAG).toMatch(/uniform float uBloom/)
    expect(COMPOSITE_FRAG).toMatch(/uniform float uDetail/)
  })
  it('has no colour literal and no template placeholder left in the GLSL (P-S1)', () => {
    for (const src of [COMPOSITE_FRAG, FOG_FRAG]) {
      expect(src).not.toMatch(/\$\{/)
      expect(src).not.toMatch(/vec3\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)\s*\)?;?\s*\/\/\s*colour/i)
      expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/)
    }
  })
  it('ends with the --ink clamp (R12.3)', () => {
    const tail = COMPOSITE_FRAG.slice(COMPOSITE_FRAG.lastIndexOf('col = min(col, uInk)'))
    expect(tail).toContain('oColor = vec4(col, 1.0)')
  })
  it('does not contain the v0 hash-grid drip (R4.8)', () => {
    expect(COMPOSITE_FRAG).not.toContain('h > 0.9 && c < 0.2')
  })
})
