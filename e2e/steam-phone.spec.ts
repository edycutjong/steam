// R10, R11, R19, R20: the phone layout, the button and keyboard, the live region and reduced motion.
import { expect, test } from '@playwright/test'
import { MIN_CORE_CSS_PX, PAD_PX } from '../src/steam/layout.ts'
import { heroPaneImage, heroUrl } from './helpers/hero.ts'
import { VIEWPORTS, canvasOrigin, canvasRegion, channelPixels, meanLumAt, openPane, readLayout, shot } from './helpers/pane.ts'

// R19.4: the crossfade is 600 ms. Written out here because StaticPane.tsx is a React module the node project cannot import.
const CROSSFADE_MS = 600
const EXPECTED = "The writer's note, handwritten: till it Looks red & smooth"

for (const [name, viewport] of [
  ['390x844', VIEWPORTS.phone390],
  ['360x800', VIEWPORTS.phone360],
] as const) {
  test.describe(name, () => {
    test.use({ viewport })

    test('gap groups stacked in reading order, legible core bands, no ink in the side padding', async ({ page }) => {
      await openPane(page, '?t=5000')
      const layout = await readLayout(page)
      const o = await canvasOrigin(page)
      expect(layout.kind).toBe('groups')
      // steam-renderer-v1 R8, R15: every line is cut at its one wide ink gap and the four parts are stacked in reading order at one
      // larger scale, which uses the glass (look pass 2; v1 cut only the second line: [[0,0],[1,0],[1,1]]).
      expect(layout.groups.map((g) => [g.index, g.part])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
      expect(layout.fits).toBe(true)
      for (const g of layout.groups) {
        expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
        expect(g.inked[2] + PAD_PX, 'inked right edge plus padding').toBeLessThanOrEqual(o.w)
        expect(g.inked[0], 'inked left edge').toBeGreaterThanOrEqual(PAD_PX - 1)
      }
      // The transparent margins may overlap; the inked rectangles may not.
      for (let i = 1; i < layout.groups.length; i++) expect(layout.groups[i - 1].inked[3], 'groups stacked, not overlapping').toBeLessThanOrEqual(layout.groups[i].inked[1])

      // Ink pixels from the scan, mapped through the layout, stay out of the right-most PAD_PX px.
      const pts = await channelPixels(page)
      expect(Math.max(...pts.map(([x]) => x))).toBeLessThanOrEqual(o.x + o.w - PAD_PX)
      // And the glass there is untouched: the right strip looks the same at t=5000 and t=-1 (without the cue's bloom, which lives at the edges).
      await openPane(page, '?t=5000&bloom=0')
      const held = await shot(page)
      await openPane(page, '?t=-1&bloom=0')
      const fogged = await shot(page)
      const c = await canvasRegion(page)
      const strip: Array<[number, number]> = []
      for (let y = c.y; y < c.y + c.h; y += 2) for (let x = c.x + c.w - PAD_PX; x < c.x + c.w; x++) strip.push([x, y])
      // the candle stands at the lower right and the bloom is off at 5000: compare above the candle only
      const stripAbove = strip.filter(([, y]) => y < c.y + c.h * 0.6)
      expect(Math.abs(meanLumAt(held, stripAbove) - meanLumAt(fogged, stripAbove))).toBeLessThan(10)
    })

    test('the button is at least 48x48 and Space starts the reveal', async ({ page }) => {
      await openPane(page, '?lead=60000')
      const btn = page.locator('.wipe-btn')
      const box = await btn.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(48)
      expect(box?.height).toBeGreaterThanOrEqual(48)
      await expect(btn).toHaveText('Show the note')
      await page.keyboard.press('Space')
      await expect(btn).toHaveText('Writing…', { timeout: 2000 })
      await expect(btn).toHaveAttribute('aria-disabled', 'true')
      expect(await page.evaluate(() => window.scrollY), 'Space did not scroll the page').toBe(0)
    })

    test('the live region carries the transcription within 2 s of the reveal start', async ({ page }) => {
      await openPane(page, '?lead=60000')
      const live = page.locator('[role="status"]')
      await expect(live).toHaveText('')
      await page.locator('.wipe-btn').click()
      await expect(live).toHaveText(EXPECTED, { timeout: 2000 })
      await expect(page.locator('.steam-canvas')).toHaveAttribute('aria-hidden', 'true')
    })

    test('prefers-reduced-motion: StaticPane, same text, opacity-only crossfade', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(heroUrl('?lead=0'))
      await page.locator('.static-pane').waitFor()
      await expect(page.locator('.steam-canvas')).toHaveCount(0)
      await expect(page.locator('[role="status"]')).toHaveText(EXPECTED, { timeout: 2000 })
      const imgs = await page.locator('.static-pane img').evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el)
          return {
            src: el.getAttribute('src'),
            property: cs.transitionProperty,
            duration: cs.transitionDuration,
            transform: cs.transform,
            opacity: cs.opacity,
          }
        }),
      )
      expect(imgs.map((i) => i.src)).toEqual([
        heroPaneImage('groups', 'fogged'),
        heroPaneImage('groups', 'held'),
        heroPaneImage('groups', 'wiped'),
      ])
      const [fogged, held, wiped] = imgs
      expect(held.property).toBe('opacity')
      expect(held.duration).toBe(`${CROSSFADE_MS / 1000}s`)
      expect(held.transform, 'no spatial motion').toBe('none')
      expect(fogged.opacity).toBe('1')
      await expect.poll(async () => (await page.locator('.static-pane img').nth(1).evaluate((e) => getComputedStyle(e).opacity))).toBe('1')
      expect(wiped.opacity, 'the cleared-glass image waits for the wipe').toBe('0')
    })
  })
}
