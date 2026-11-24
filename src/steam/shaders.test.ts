import { describe, expect, it } from 'vitest'
import { CLEAR_HALF_THICK, CLEAR_HALF_THIN, COMPOSITE_FRAG, PLUME_A, PLUME_H0, PLUME_H2, PLUME_REACH, STREAK_A, STREAK_HALF_CSS, STROKE_LUMA_MAX, THROUGH_FAR, THROUGH_K, THROUGH_NEAR } from './shaders.ts'
import { parseColor } from './tokens.ts'

/** --after, the only colour the plume adds. */
const AFTER = '#F2A65A'

describe('composite constants', () => {
  it('keeps the plume under 2 levels of warmth above PLUME_REACH', () => {
    const [r, , b] = parseColor(AFTER)
    expect(PLUME_A * Math.exp(-((PLUME_REACH - PLUME_H0) ** 2) / PLUME_H2) * (r - b) * 255).toBeLessThan(2)
  })
  it('keeps the streak faint and narrow (D10)', () => {
    expect(STREAK_A).toBeLessThanOrEqual(0.12)
    expect(2 * STREAK_HALF_CSS).toBeGreaterThanOrEqual(8)
    expect(2 * STREAK_HALF_CSS).toBeLessThanOrEqual(12)
  })
  it('lets the light behind the glass fall off from the pot to the top of the pane (D13)', () => {
    // Pot at (0.5, 1.18); the top centre of the pane is 1.18 away, the bottom centre 0.18.
    const gain = (d: number): number => THROUGH_FAR + (THROUGH_NEAR - THROUGH_FAR) * Math.exp(-d * d * THROUGH_K)
    expect(gain(0.18)).toBeGreaterThan(gain(1.18) * 1.8)
    expect(gain(1.18)).toBeLessThan(0.55)
  })
  it('makes the edge crisper in thick fog than in thin fog (D13)', () => {
    expect(CLEAR_HALF_THICK).toBeLessThan(CLEAR_HALF_THIN)
  })
  it('caps stroke luminance at 92% and keeps --ink under that cap too (D14)', () => {
    expect(STROKE_LUMA_MAX).toBeLessThanOrEqual(0.92)
    const [r, g, b] = parseColor('#EFE7DA')
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(STROKE_LUMA_MAX - 0.03)
    expect(COMPOSITE_FRAG).toContain('STROKE_LUMA_MAX / max(lum')
  })
  it('has no template placeholders left in the GLSL', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/\$\{/)
  })
})
