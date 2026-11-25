// R1 and R2: nothing of the note before the reveal, and the reveal happens on time.
import { expect, test } from '@playwright/test'
import { LEAD_MS, WRITE_ON_MS } from '../src/steam/timeline.ts'
import type { Region } from './helpers/capture.ts'
import { heroUrl } from './helpers/hero.ts'
import { VIEWPORTS, canvasRegion, detailVariance, groupRegions, openPane, poolStats, shot, sideStrips } from './helpers/pane.ts'

test.use({ viewport: VIEWPORTS.desktop })

// Fog shades vary slowly down and across the pane, so the note's area is compared with fog on the same rows.
// Variance is taken on the high-pass residual (detailVariance): the stacked desktop layout makes each group rect
// about 840 px wide, and raw variance over that width picks up the fog's slow shading (3.9x with no note at all).
const MEAN_TOL = 8
const VARIANCE_RATIO = 1.6
// Ember light is warm (red above blue). Fog is blue-grey, so its warmest pixel stays below this.
// Was 6. With the stacked desktop layout the lower group sits centred over the pot's glow, which shows through
// the thinner pre-thicken fog at up to 8 (measured at t=-3000 with the plume off: 7). A written note reaches
// about 100 (asserted below), so 16 still separates fog from ember.
// Re-pinned in cook-mode task 31 for the bundle's hero note, whose lower group sits nearer the glow: the warmest fog pixel in the
// group regions measured 19 at t=-3000, t=-1500, t=-1 and 2000 ms after load (the screenshot at t=-3000 shows no ink).
// Re-pinned in steam-renderer-v1: droplets are lenses that carry the room's warm light, and the candle warms the film at the lower right.
// The warmest fog pixel in the group regions measured 52 to 54 at t=-3000, t=-1500, t=-1 and 2000 ms after load. A written stroke is far warmer.
const WARMTH_MAX = 64

// The bottom 7 % holds the rail beads and the lowest 20 % holds the pot's and the candle's warm scatter (v1 design §5).
const BEAD_ZONE = 0.07
const PLUME_REACH = 0.2

// Beads on the bottom rail and the pot's plume are warm by design (D4, D11). In the stacked desktop layout
// the lower group's margin reaches them, so the comparison uses only rows above both.
function aboveBeads(r: Region, bounds: Region): Region {
  const limit = Math.floor(bounds.y + bounds.h * (1 - Math.max(BEAD_ZONE, PLUME_REACH))) - 1
  return { ...r, h: Math.max(0, Math.min(r.h, limit - r.y)) }
}

for (const t of [-3000, -1500, -1]) {
  test(`t=${t}: the note's area is statistically the same as fog beside it`, async ({ page }) => {
    await openPane(page, `?t=${t}`)
    const png = await shot(page)
    const bounds = await canvasRegion(page)
    const groups = (await groupRegions(page, png)).map((g) => aboveBeads(g, bounds))
    for (const g of groups) {
      const inside = poolStats(png, [g])
      const beside = poolStats(png, sideStrips(g, groups, bounds))
      expect(Math.abs(inside.mean - beside.mean), 'mean luminance').toBeLessThan(MEAN_TOL)
      const ratio = detailVariance(png, [g]) / detailVariance(png, sideStrips(g, groups, bounds))
      expect(ratio, 'detail variance ratio').toBeLessThan(VARIANCE_RATIO)
      expect(ratio, 'detail variance ratio').toBeGreaterThan(1 / VARIANCE_RATIO)
      expect(inside.warmth, 'no ember-coloured pixel').toBeLessThan(WARMTH_MAX)
    }
  })
}

test('t=5000: the detail variance check sees a written note', async ({ page }) => {
  await openPane(page, '?t=5000')
  const png = await shot(page)
  const bounds = await canvasRegion(page)
  const groups = (await groupRegions(page, png)).map((g) => aboveBeads(g, bounds))
  const ratio = detailVariance(png, [groups[0]]) / detailVariance(png, sideStrips(groups[0], groups, bounds))
  // Re-pinned in cook-mode task 31: the bundle note's owned-ink alpha is soft (938 pixels above 200, the spike's was mostly opaque),
  // so the written strokes add less stroke-scale detail: measured 1.74 at t=5000. Fog alone stays below VARIANCE_RATIO (asserted
  // above), and the warmth check that follows separates fog from ember by more than three times.
  expect(ratio).toBeGreaterThan(VARIANCE_RATIO)
  expect(poolStats(png, [groups[0]]).warmth).toBeGreaterThan(WARMTH_MAX * 1.5)
})

test('no t: nothing of the note 2000 ms after load', async ({ page }) => {
  await page.goto(heroUrl())
  const loaded = Date.now()
  await page.locator('.steam-canvas').waitFor()
  await page.waitForFunction(() => performance.getEntriesByName('steam:first-frame').length > 0)
  await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - loaded)))
  const png = await shot(page)
  const bounds = await canvasRegion(page)
    const groups = (await groupRegions(page, png)).map((g) => aboveBeads(g, bounds))
  for (const g of groups) {
    const inside = poolStats(png, [g])
    const beside = poolStats(png, sideStrips(g, groups, bounds))
    expect(Math.abs(inside.mean - beside.mean)).toBeLessThan(MEAN_TOL)
    expect(detailVariance(png, [g]) / detailVariance(png, sideStrips(g, groups, bounds))).toBeLessThan(VARIANCE_RATIO)
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
  await page.goto(heroUrl())
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
