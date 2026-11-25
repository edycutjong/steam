// R4, R5, R6: no white hotspot, glass details, and no patch around the note.
import { expect, test } from '@playwright/test'
import { regionStats } from './helpers/capture.ts'
import {
  INK_LUMINANCE,
  TOKENS,
  VIEWPORTS,
  baselineEdgeStep,
  canvasOrigin,
  canvasRegion,
  groupRegions,
  openPane,
  pixel,
  readLayout,
  rectEdgeStep,
  shot,
} from './helpers/pane.ts'

const SIZES = [
  ['desktop', VIEWPORTS.desktop],
  ['390 px', VIEWPORTS.phone390],
] as const
const TIMES = [-1000, 1000, 2500, 5000, 9000]

for (const [name, viewport] of SIZES) {
  test.describe(name, () => {
    test.use({ viewport })

    test('no pixel is brighter than --ink', async ({ page }) => {
      for (const t of TIMES) {
        await openPane(page, `?t=${t}`)
        const { max } = regionStats(await shot(page))
        // One level of slack for 8-bit rounding of the luminance sum.
        expect(max, `brightest pixel at t=${t}`).toBeLessThanOrEqual(INK_LUMINANCE + 1)
      }
    })

    test('no stroke pixel exceeds 92% luminance and the ember hue survives in the strokes (D14)', async ({ page }) => {
      await openPane(page, '?t=6000')
      const png = await shot(page)
      const regions = await groupRegions(page, png)
      let max = 0
      let ember = 0
      for (const r of regions) {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            const [R, G, B] = pixel(png, x, y)
            max = Math.max(max, 0.2126 * R + 0.7152 * G + 0.0722 * B)
            // --after family: red clearly above green above blue.
            if (R - B > 60 && R > G && G > B) ember++
          }
        }
      }
      expect(max, 'brightest pixel over the groups').toBeLessThanOrEqual(0.92 * 255 + 1)
      expect(ember, 'ember-coloured pixels in the groups').toBeGreaterThan(300)
    })

    test('no 1 px border or outline-like shadow on pane, canvas or caption', async ({ page }) => {
      await openPane(page, '?t=5000')
      const styles = await page.evaluate(() =>
        ['.steam-root', '.steam-canvas', '.credit', '.sash--lower'].map((sel) => {
          const cs = getComputedStyle(document.querySelector(sel)!)
          return {
            sel,
            widths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
            outline: cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth,
            shadow: cs.boxShadow,
          }
        }),
      )
      for (const s of styles) {
        expect(s.widths, `${s.sel} border widths`).toEqual(['0px', '0px', '0px', '0px'])
        expect(s.outline, `${s.sel} outline`).toBe('0px')
        expect(s.shadow, `${s.sel} box-shadow`).toBe('none')
      }
    })

    test('the sash bar is --rule wood', async ({ page }) => {
      await openPane(page, '?t=5000')
      const png = await shot(page)
      const sash = await page.locator('.sash--lower').boundingBox()
      const o = await canvasOrigin(page)
      if (!sash) throw new Error('no sash box')
      const bar = o.x - sash.x
      expect(bar).toBeGreaterThan(8)
      const [r, g, b] = pixel(png, sash.x + bar / 2, sash.y + sash.height / 2)
      // The bar is a gradient of --rule with --bg grain, so match within a band rather than exactly.
      for (const [got, want] of [[r, TOKENS.rule[0]], [g, TOKENS.rule[1]], [b, TOKENS.rule[2]]]) {
        expect(Math.abs(got - want)).toBeLessThanOrEqual(24)
      }
    })

    test('droplets cover the film and gather toward the bottom rail, and a streak crosses the top third', async ({ page }) => {
      await openPane(page, '?t=-1000')
      const png = await shot(page)
      const o = await canvasRegion(page)
      const x = o.x + Math.round(o.w * 0.1)
      const w = Math.round(o.w * 0.8)
      const zoneH = Math.round(o.h * 0.07)
      // A bead pixel departs from the fog around it: dark rim, bright catch-light. Count pixels that differ
      // from the same row 20 px to the left and right by more than DEV levels. Smooth fog gives none.
      const DEV = 14
      const beadPixels = (y0: number): number => {
        let n = 0
        for (let y = y0; y < y0 + zoneH; y++) {
          for (let xx = x + 20; xx < x + w - 20; xx++) {
            const lum = (px: number): number => {
              const [r, g, b] = pixel(png, px, y)
              return 0.2126 * r + 0.7152 * g + 0.0722 * b
            }
            const around = (lum(xx - 20) + lum(xx + 20)) / 2
            if (Math.abs(lum(xx) - around) > DEV) n++
          }
        }
        return n
      }
      // steam-renderer-v1 R3.3, R3.4: droplets follow the film everywhere (0.4 % of a 0.8-wide band at least) and are denser in the
      // last 7 % than in the middle band. Measured on the desktop frame at t=-1000: rail 898, middle 448, top 241 (14 levels).
      const nearRail = beadPixels(o.y + o.h - zoneH)
      const middle = beadPixels(o.y + Math.round(o.h * 0.4))
      const bandPx = zoneH * (w - 40)
      expect(middle, 'droplet pixels in the middle band').toBeGreaterThan(0.004 * bandPx)
      expect(nearRail, 'droplet pixels near the rail').toBeGreaterThan(1.5 * middle)

      // Streak: s = 0.8 u + 1.2 v = 0.55. Compare the line with parallel lines either side of it.
      const lum = (s: number): number => {
        let sum = 0
        let n = 0
        for (let v = 0.04; v <= 0.18; v += 0.02) {
          const u = (s - 1.2 * v) / 0.8
          const px = Math.round(o.x + u * o.w)
          const py = Math.round(o.y + v * o.h)
          for (let dx = -2; dx <= 2; dx++) {
            const [R, G, B] = pixel(png, px + dx, py)
            sum += 0.2126 * R + 0.7152 * G + 0.0722 * B
            n++
          }
        }
        return sum / n
      }
      const side = (lum(0.55 - 0.14) + lum(0.55 + 0.14)) / 2
      expect(lum(0.55) - side, 'streak lift over its neighbours').toBeGreaterThan(3)
    })

    test('no fog patch around the note: edge steps stay within plain-fog variation', async ({ page }) => {
      for (const t of [-1000, 1000]) {
        await openPane(page, `?t=${t}`)
        const png = await shot(page)
        const [layout, o, regions, bounds] = await Promise.all([
          readLayout(page),
          canvasOrigin(page),
          groupRegions(page, png),
          canvasRegion(page),
        ])
        const baseline = baselineEdgeStep(png, bounds, regions)
        for (const g of layout.groups) {
          // At t=1000 only the first group is being written; the second has no ink revealed yet.
          if (t > 0 && g.index === 0) continue
          // A group whose ink reaches the pane edge (the bundle hero's group 1 at 390 px: ink -1 to 371 on a 370 px pane, see
          // steam-phone.spec.ts) has the sash wood as its edge; that step is the frame, not fog. Re-pinned in cook-mode task 31.
          if (g.inked[0] < 1 || g.inked[2] > o.w - 1) continue
          const step = rectEdgeStep(png, {
            x0: o.x + g.inked[0],
            y0: o.y + g.inked[1],
            x1: o.x + g.inked[2],
            y1: o.y + g.inked[3],
          })
          // 3 levels cover the pass-1 grain (R6.4).
          expect(step, `group ${g.index} edge step at t=${t} (plain fog ${baseline.toFixed(2)})`).toBeLessThanOrEqual(
            baseline + 3,
          )
        }
      }
    })
  })
}
