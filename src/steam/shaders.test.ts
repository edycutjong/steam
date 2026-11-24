import { describe, expect, it } from 'vitest'
import { COMPOSITE_FRAG, PLUME_A, PLUME_H2, PLUME_REACH, STREAK_A, STREAK_HALF_CSS } from './shaders.ts'
import { parseColor } from './tokens.ts'

/** --after, the only colour the plume adds. */
const AFTER = '#F2A65A'

describe('composite constants', () => {
  it('keeps the plume under 2 levels of warmth above PLUME_REACH', () => {
    const [r, , b] = parseColor(AFTER)
    expect(PLUME_A * Math.exp(-(PLUME_REACH ** 2) / PLUME_H2) * (r - b) * 255).toBeLessThan(2)
  })
  it('keeps the streak faint and narrow (D10)', () => {
    expect(STREAK_A).toBeLessThanOrEqual(0.12)
    expect(2 * STREAK_HALF_CSS).toBeGreaterThanOrEqual(8)
    expect(2 * STREAK_HALF_CSS).toBeLessThanOrEqual(12)
  })
  it('has no template placeholders left in the GLSL', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/\$\{/)
  })
})
