import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { initialZoom, MAX_ZOOM, zoomPan, type ZoomAction } from './facsimile.ts'

// K4 (design 13): zoom and pan.
const action: fc.Arbitrary<ZoomAction> = fc.oneof(
  fc.record({ type: fc.constant('zoomAt' as const), factor: fc.double({ min: 0.1, max: 4, noNaN: true }), cx: fc.double({ min: 0, max: 800, noNaN: true }), cy: fc.double({ min: 0, max: 600, noNaN: true }) }),
  fc.record({ type: fc.constant('pan' as const), dx: fc.double({ min: -2000, max: 2000, noNaN: true }), dy: fc.double({ min: -2000, max: 2000, noNaN: true }) }),
  fc.constant<ZoomAction>({ type: 'reset' }),
  fc.record({ type: fc.constant('resize' as const), w: fc.integer({ min: 100, max: 1600 }), h: fc.integer({ min: 100, max: 1200 }) }),
)

describe('K4: zoom and pan', () => {
  it('scale stays in [1, MAX_ZOOM], the image covers the viewport, zoomAt keeps its point unless clamped, reset is {1, 0, 0}; deterministic', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1600 }), fc.integer({ min: 100, max: 1200 }), fc.array(action, { maxLength: 30 }), (w, h, acts) => {
        let s = initialZoom(w, h, 1601, 2052)
        for (const a of acts) {
          const next = zoomPan(s, a)
          expect(zoomPan(s, a)).toEqual(next)
          expect(next.scale).toBeGreaterThanOrEqual(1)
          expect(next.scale).toBeLessThanOrEqual(MAX_ZOOM)
          const iw = next.vw * next.scale
          const ih = ((next.vw * 2052) / 1601) * next.scale
          expect(next.x).toBeLessThanOrEqual(1e-9)
          expect(next.x + iw).toBeGreaterThanOrEqual(next.vw - 1e-6)
          if (ih >= next.vh) {
            expect(next.y).toBeLessThanOrEqual(1e-9)
            expect(next.y + ih).toBeGreaterThanOrEqual(next.vh - 1e-6)
          }
          if (a.type === 'zoomAt') {
            const px = (a.cx - s.x) / s.scale
            const after = next.x + px * next.scale
            const clampedX = Math.abs(next.x) < 1e-9 || Math.abs(next.x + iw - next.vw) < 1e-6
            if (!clampedX) expect(after).toBeCloseTo(a.cx, 6)
          }
          if (a.type === 'reset') expect(next.scale).toBe(1)
          if (a.type === 'reset') expect(next.x).toBe(0)
          s = next
        }
      }),
      { numRuns: 400 },
    )
  })
})
