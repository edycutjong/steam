import { describe, expect, it } from 'vitest'
import { initialZoom, MAX_ZOOM, zoomPan } from './facsimile.ts'

const s0 = initialZoom(400, 300, 1601, 2052) // fitted height 512.9: taller than the viewport

describe('zoomPan (R5.3, R5.4)', () => {
  it('MAX_ZOOM is 6', () => expect(MAX_ZOOM).toBe(6))
  it('zoom x2 at the centre keeps the centre point', () => {
    const s = zoomPan({ ...s0, y: -100 }, { type: 'zoomAt', factor: 2, cx: 200, cy: 150 })
    expect(s.scale).toBe(2)
    // image point under the centre before: ((200 - 0) / 1, (150 + 100) / 1); after: same point maps to the centre
    expect((200 - s.x) / s.scale).toBeCloseTo(200, 9)
    expect((150 - s.y) / s.scale).toBeCloseTo(250, 9)
  })
  it('zoom out below 1 stays at 1; above MAX_ZOOM stays at MAX_ZOOM', () => {
    expect(zoomPan(s0, { type: 'zoomAt', factor: 0.5, cx: 0, cy: 0 }).scale).toBe(1)
    expect(zoomPan(s0, { type: 'zoomAt', factor: 100, cx: 0, cy: 0 }).scale).toBe(MAX_ZOOM)
  })
  it('pan beyond the edge clamps', () => {
    const z = zoomPan(s0, { type: 'zoomAt', factor: 2, cx: 0, cy: 0 })
    expect(zoomPan(z, { type: 'pan', dx: 999, dy: 999 })).toMatchObject({ x: 0, y: 0 })
    const far = zoomPan(z, { type: 'pan', dx: -99999, dy: -99999 })
    expect(far.x).toBeCloseTo(400 - 800, 9)
    expect(far.y).toBeCloseTo(300 - (400 * 2052) / 1601 * 2, 6)
  })
  it('resize re-clamps', () => {
    const z = zoomPan(zoomPan(s0, { type: 'zoomAt', factor: 3, cx: 0, cy: 0 }), { type: 'pan', dx: -9999, dy: 0 })
    const r = zoomPan(z, { type: 'resize', w: 900, h: 300 })
    expect(r.x).toBeGreaterThanOrEqual(900 - 900 * r.scale - 1e-9)
    expect(r.x).toBeLessThanOrEqual(0)
  })
  it('reset returns to scale 1 at the origin', () => {
    const z = zoomPan(zoomPan(s0, { type: 'zoomAt', factor: 4, cx: 100, cy: 100 }), { type: 'reset' })
    expect(z).toMatchObject({ scale: 1, x: 0, y: 0 })
  })
})
