// R8 (steam-renderer-v1): at 390 and 393 css px wide every group keeps its 16 css px core band and the note never touches
// or leaves the glass: at least 12 css px of clear glass either side, measured on the ink pixels, not on the rect.
import { expect, test } from '@playwright/test'
import { MIN_CORE_CSS_PX } from '../src/steam/layout.ts'
import { canvasOrigin, channelPixels, openPane, readLayout } from './helpers/pane.ts'

const CLEAR_CSS = 12

for (const [name, viewport] of [
  ['390', { width: 390, height: 844 }],
  ['393', { width: 393, height: 851 }],
] as const) {
  test.describe(`${name} css px wide`, () => {
    test.use({ viewport })

    test('every group keeps the minimum core band and the ink keeps 12 css px of glass on both sides', async ({ page }) => {
      await openPane(page, '?t=6000')
      const layout = await readLayout(page)
      const o = await canvasOrigin(page)
      expect(layout.kind).toBe('groups')
      expect(layout.fits, 'the layout reports that everything fits').toBe(true)
      for (const g of layout.groups) expect(g.coreBandCssPx, `group ${g.index}.${g.part ?? 0} core band`).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
      const pts = await channelPixels(page)
      expect(pts.length).toBeGreaterThan(500)
      const left = Math.min(...pts.map(([x]) => x)) - o.x
      const right = o.x + o.w - Math.max(...pts.map(([x]) => x))
      expect(left, 'clear glass left of the ink').toBeGreaterThanOrEqual(CLEAR_CSS)
      expect(right, 'clear glass right of the ink').toBeGreaterThanOrEqual(CLEAR_CSS)
      const top = Math.min(...pts.map(([, y]) => y)) - o.y
      const bottom = o.y + o.h - Math.max(...pts.map(([, y]) => y))
      expect(top, 'clear glass above the ink').toBeGreaterThanOrEqual(CLEAR_CSS)
      expect(bottom, 'clear glass below the ink').toBeGreaterThanOrEqual(CLEAR_CSS)
    })
  })
}
