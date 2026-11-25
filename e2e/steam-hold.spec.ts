// R7, R9, R10: the written note stays, no text-coloured layer over fog, and the cook's wipe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { REFOG_MS, WIPE_MS, WRITE_ON_MS } from '../src/steam/timeline.ts'
import { luminance } from './helpers/capture.ts'
import {
  TOKENS,
  VIEWPORTS,
  canvasOrigin,
  canvasRegion,
  channelPixels,
  meanLumAt,
  openPane,
  pixel,
  readLayout,
  shot,
} from './helpers/pane.ts'

test.use({ viewport: VIEWPORTS.desktop })

const WIPE = 'Wipe the glass'
const SHOW = 'Show the note'
const WRITING = 'Writing…'
// Fog drift and the pot's flicker move a clear pixel by a few levels between two frozen times.
const SAME_CLEAR_TOL = 6

test('channels hold the same clear amount at t=5000 and t=9000', async ({ page }) => {
  await openPane(page, '?t=5000')
  const pts = await channelPixels(page)
  const a = await shot(page)
  await openPane(page, '?t=9000')
  const b = await shot(page)
  await openPane(page, '?t=-1')
  const fogged = await shot(page)
  expect(Math.abs(meanLumAt(a, pts) - meanLumAt(b, pts)), 'channel luminance, 5000 vs 9000').toBeLessThan(SAME_CLEAR_TOL)
  // The channels really are clear: far brighter than the same pixels under fog.
  expect(meanLumAt(a, pts) - meanLumAt(fogged, pts), 'clear minus fogged').toBeGreaterThan(30)
  // Per pixel, a channel pixel that was clear at 5000 is still clear at 9000.
  let drifted = 0
  for (const [x, y] of pts) {
    const [r1, g1, b1] = pixel(a, x, y)
    const [r2, g2, b2] = pixel(b, x, y)
    if (Math.abs(luminance(r1, g1, b1) - luminance(r2, g2, b2)) > 20) drifted++
  }
  expect(drifted / pts.length, 'channel pixels that changed by more than 20 levels').toBeLessThan(0.01)
})

for (const t of [5000, 9000]) {
  test(`t=${t}: no text-coloured pixel over fog at the channels, and a cold rim`, async ({ page }) => {
    await openPane(page, `?t=${t}`)
    const pts = await channelPixels(page)
    const png = await shot(page)
    const near = (p: readonly number[], c: readonly number[], tol: number): boolean =>
      Math.abs(p[0] - c[0]) < tol && Math.abs(p[1] - c[1]) < tol && Math.abs(p[2] - c[2]) < tol
    const PAPER = [0xe8, 0xdc, 0xc2]
    let textColoured = 0
    for (const [x, y] of pts) {
      const p = pixel(png, x, y)
      if (near(p, TOKENS.ink, 20) || near(p, PAPER, 20)) textColoured++
    }
    expect(textColoured, 'channel pixels coloured like --ink or --paper').toBe(0)

    // Re-pinned in look pass 3 (72 to 90, measured 82.7 at t=5000 and 82.2 at t=9000): the fog-side cold ring is gone, the edge is a meniscus
    // (a thin lamp-side highlight, broken), so the cold pixels beside a stroke are the film's own and sit further from --ghost.
    // Re-pinned in look pass 2 (R14.1): the rim is at most 1 css px and broken by the film height, so the brightest cold pixels near a
    // channel sit further from --ghost (blue off by 66 against the old bound of 60); the bound is 72.
    // Rim: the brightest cold pixels (blue at least as strong as red) within 6 px of a channel.
    const on = new Set(pts.map(([x, y]) => y * 10000 + x))
    const cold: Array<[number, number[]]> = []
    for (const [x, y] of pts) {
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (on.has((y + dy) * 10000 + x + dx)) continue
          const p = pixel(png, x + dx, y + dy)
          if (p[2] >= p[0]) cold.push([luminance(p[0], p[1], p[2]), p])
        }
      }
    }
    cold.sort((a, b) => b[0] - a[0])
    const top = cold.slice(0, Math.max(1, Math.floor(cold.length / 100)))
    const mean = [0, 1, 2].map((i) => top.reduce((s, c) => s + c[1][i], 0) / top.length)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(mean[i] - TOKENS.ghost[i]), `rim channel ${i} vs --ghost`).toBeLessThan(90)
    }
  })
}

async function label(page: Page): Promise<string> {
  return (await page.locator('.wipe-btn').textContent()) ?? ''
}

/** Fraction of columns in a top band of plain glass whose luminance moved from the fogged reference. */
// Columns under a group's destination rect (the note and its hull margin) are not plain glass: the hull never refogs (D10).
// Re-pinned in cook-mode task 31: the bundle's hero note puts group 0's dst rect at y 0 to 210 of a 345 px desktop pane, so the old
// top band (y 4 to 40) now crosses the hull over 742 of 1236 columns; the spike's note left that band clear.
async function clearedFraction(page: Page, ref: Awaited<ReturnType<typeof shot>>): Promise<number> {
  const png = await shot(page)
  const c = await canvasRegion(page)
  const o = await canvasOrigin(page)
  const covered = (await readLayout(page)).groups.map((g) => [o.x + g.dst[0], o.x + g.dst[2]] as const)
  let cleared = 0
  let cols = 0
  const y0 = c.y + 4
  const y1 = c.y + 40
  for (let x = c.x; x < c.x + c.w; x++) {
    if (covered.some(([a, b]) => x >= a - 2 && x <= b + 2)) continue
    cols++
    let d = 0
    for (let y = y0; y < y1; y++) {
      const [r1, g1, b1] = pixel(png, x, y)
      const [r2, g2, b2] = pixel(ref, x, y)
      d += luminance(r1, g1, b1) - luminance(r2, g2, b2)
    }
    if (Math.abs(d / (y1 - y0)) > 15) cleared++
  }
  return cols ? cleared / cols : 0
}

test('the button and Space: disabled while writing, wipe sweeps, fog returns off the channels', async ({ page }) => {
  test.setTimeout(WRITE_ON_MS + WIPE_MS + REFOG_MS + 60_000)
  await openPane(page, '?lead=0')
  const btn = page.locator('.wipe-btn')
  await expect(btn).toHaveAttribute('aria-disabled', 'true')
  expect(await label(page)).toBe(WRITING)
  await btn.click({ force: true })
  expect(await label(page), 'activation is ignored while writing').toBe(WRITING)

  await expect(btn).toHaveText(WIPE, { timeout: WRITE_ON_MS + 10_000 })
  await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
  const pts = await channelPixels(page)
  // the cue's cold bloom at the pane edges is gone 1.5 s after the hold begins (haunt.ts BLOOM_FADE_MS); the reference is taken after it
  await page.waitForTimeout(1700)
  const held = await shot(page)
  const heldChannel = meanLumAt(held, pts)

  // Wipe with Space (focus is on the body, so the key handler runs). The sweep must pass through partial states.
  const wipedAt = Date.now()
  await page.keyboard.press('Space')
  await expect(btn).toHaveText(SHOW)
  const samples: number[] = []
  while (Date.now() - wipedAt < WIPE_MS + 600) samples.push(await clearedFraction(page, held))
  const partial = samples.filter((f) => f > 0.05 && f < 0.95)
  expect(partial.length, `a sweep in progress was seen in ${samples.map((f) => f.toFixed(2)).join(' ')}`).toBeGreaterThan(0)
  for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.05)
  expect(await clearedFraction(page, held), 'glass fully clear after the sweep').toBeGreaterThan(0.95)

  // Fog returns outside the hull and never over the channels.
  const wait = REFOG_MS + 1500 - (Date.now() - wipedAt)
  if (wait > 0) await page.waitForTimeout(wait)
  const after = await shot(page)
  expect(await clearedFraction(page, held), 'plain glass fogged again').toBeLessThan(0.05)
  expect(Math.abs(meanLumAt(after, pts) - heldChannel), 'channels stay clear').toBeLessThan(SAME_CLEAR_TOL + 6)

  // Replay by button: thickening, then writing, then disabled again.
  await btn.click()
  await expect(btn).toHaveText(WRITING, { timeout: 6000 })
  await expect(btn).toHaveAttribute('aria-disabled', 'true')
})
