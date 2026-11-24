// R1 and R2: nothing of the note before the reveal, and the reveal happens on time.
import { expect, test } from '@playwright/test'
import { LEAD_MS, WRITE_ON_MS } from '../src/steam/timeline.ts'
import { VIEWPORTS, canvasRegion, groupRegions, openPane, poolStats, shot, sideStrips } from './helpers/pane.ts'

test.use({ viewport: VIEWPORTS.desktop })

// Fog shades vary slowly down and across the pane (up to about 5 levels), so the note's area is compared with fog on the same rows.
// A visible note would move the variance by 5x or more (measured at t=5000: 52 to 467), so the tolerance has room.
const MEAN_TOL = 8
const VARIANCE_RATIO = 1.6
// Ember light is warm (red above blue). Fog is blue-grey, so its warmest pixel stays below this.
const WARMTH_MAX = 6

for (const t of [-3000, -1500, -1]) {
  test(`t=${t}: the note's area is statistically the same as fog beside it`, async ({ page }) => {
    await openPane(page, `?t=${t}`)
    const png = await shot(page)
    const groups = await groupRegions(page, png)
    const bounds = await canvasRegion(page)
    for (const g of groups) {
      const inside = poolStats(png, [g])
      const beside = poolStats(png, sideStrips(g, groups, bounds))
      expect(Math.abs(inside.mean - beside.mean), 'mean luminance').toBeLessThan(MEAN_TOL)
      expect(inside.variance / beside.variance, 'variance ratio').toBeLessThan(VARIANCE_RATIO)
      expect(inside.variance / beside.variance, 'variance ratio').toBeGreaterThan(1 / VARIANCE_RATIO)
      expect(inside.warmth, 'no ember-coloured pixel').toBeLessThan(WARMTH_MAX)
    }
  })
}

test('no t: nothing of the note 2000 ms after load', async ({ page }) => {
  await page.goto('/')
  const loaded = Date.now()
  await page.locator('.steam-canvas').waitFor()
  await page.waitForFunction(() => performance.getEntriesByName('steam:first-frame').length > 0)
  await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - loaded)))
  const png = await shot(page)
  const groups = await groupRegions(page, png)
    const bounds = await canvasRegion(page)
  for (const g of groups) {
    const inside = poolStats(png, [g])
    const beside = poolStats(png, sideStrips(g, groups, bounds))
    expect(Math.abs(inside.mean - beside.mean)).toBeLessThan(MEAN_TOL)
    expect(inside.variance / beside.variance).toBeLessThan(VARIANCE_RATIO)
    expect(inside.warmth).toBeLessThan(WARMTH_MAX)
  }
})

test('the write-on starts LEAD_MS after the first frame and holds WRITE_ON_MS later', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __marks: Record<string, number> }
    w.__marks = {}
    const watch = (): void => {
      const live = document.querySelector('[role="status"]')
      const btn = document.querySelector('.wipe-btn')
      if (!live || !btn) return void requestAnimationFrame(watch)
      new MutationObserver(() => {
        if (live.textContent && !('write' in w.__marks)) w.__marks.write = performance.now()
      }).observe(live, { childList: true, characterData: true, subtree: true })
      new MutationObserver(() => {
        if (btn.textContent === 'Wipe the glass' && !('hold' in w.__marks)) w.__marks.hold = performance.now()
      }).observe(btn, { childList: true, characterData: true, subtree: true })
    }
    watch()
  })
  await page.goto('/')
  await page.waitForFunction(() => 'hold' in (window as unknown as { __marks: object }).__marks, null, {
    timeout: LEAD_MS + WRITE_ON_MS + 15_000,
  })
  const m = await page.evaluate(() => ({
    first: performance.getEntriesByName('steam:first-frame')[0].startTime,
    ...(window as unknown as { __marks: { write: number; hold: number } }).__marks,
  }))
  expect(Math.abs(m.write - m.first - LEAD_MS), 'write-on start vs first frame').toBeLessThan(150)
  expect(Math.abs(m.hold - m.write - WRITE_ON_MS), 'hold vs write-on start').toBeLessThan(150)
})
