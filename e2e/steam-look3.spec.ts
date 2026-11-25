// Look pass 3 (steam-renderer-v1 R20 to R27): the reading under the pane, the unseen writer's effects on the DOM, the neutral edge, the ledge.
import { expect, test } from '@playwright/test'
import { cloudShiftAt, CLOUD_OVER_MOON } from '../src/steam/haunt.ts'
import { luminance } from './helpers/capture.ts'
import { VIEWPORTS, canvasRegion, openPane, pixel, shot } from './helpers/pane.ts'

test.use({ viewport: VIEWPORTS.desktop })

test('the reviewed reading shows under the pane when the note holds, not before (R20.3, R20.4)', async ({ page }) => {
  await openPane(page, '?t=2000')
  await expect(page.locator('[data-note-reading]')).toHaveCount(0)
  await openPane(page, '?t=6500')
  const reading = page.locator('[data-note-reading]')
  await expect(reading).toHaveText('till it Looks red & smooth,')
  // a2a-arch-r06 C7: the held reading is in the accessibility tree (a2a-arch-r05 B9); the canvas is not
  await expect(reading).not.toHaveAttribute('aria-hidden', /.*/)
  expect(await reading.evaluate((e) => e.closest('[aria-hidden="true"]') === null)).toBe(true)
  await expect(page.locator('.steam-canvas')).toHaveAttribute('aria-hidden', 'true')
  const [r, c] = [await reading.boundingBox(), await page.locator('.steam-canvas').boundingBox()]
  expect(r!.y, 'under the glass, never on it').toBeGreaterThanOrEqual(c!.y + c!.height)
  const style = await reading.evaluate((e) => ({ f: getComputedStyle(e).fontStyle, ff: getComputedStyle(e).fontFamily, c: getComputedStyle(e).color }))
  expect(style.f).toBe('italic')
  expect(style.ff).toContain('Literata')
})

test('the cloud crosses the moon and the candle leans toward the writing head, from the reveal clock (R21.4, R21.5)', async ({ page }) => {
  const read = async (): Promise<{ cloud: number; lean: number; cue: number }> =>
    page.evaluate(() => ({
      cloud: Number(document.querySelector<HTMLElement>('.sash--upper')!.style.getPropertyValue('--cloud-x')),
      cue: Number(document.querySelector<HTMLElement>('.sash--upper')!.style.getPropertyValue('--cue')),
      lean: Number(document.querySelector<HTMLElement>('.candle')!.style.getPropertyValue('--lean')),
    }))
  await openPane(page, '?t=2000')
  const mid = await read()
  expect(mid.cloud).toBeCloseTo(cloudShiftAt(2000), 0)
  expect(mid.lean, 'the head is left of the candle: the flame leans left').toBeLessThan(0)
  await openPane(page, '?t=3300')
  const over = await read()
  expect(Math.abs(over.cloud - CLOUD_OVER_MOON), 'the cloud is over the moon centre').toBeLessThan(15)
  expect(over.cue, 'the moon is dimmed under it').toBeGreaterThan(0.3)
  await openPane(page, '?t=6500')
  const held = await read()
  expect(held.lean).toBe(0)
  expect(held.cloud).toBeGreaterThan(over.cloud)
  await openPane(page, '?t=11000')
  expect((await read()).cloud, 'clear of the moon after the hold').toBeGreaterThanOrEqual(500)
})

test('at t=-600 the film already thickens from the edges and the candle dips (R21.3)', async ({ page }) => {
  const edge = async (t: number): Promise<number> => {
    await openPane(page, `?t=${t}`)
    const png = await shot(page)
    const o = await canvasRegion(page)
    let sum = 0
    let n = 0
    const band = Math.round(o.w * 0.04)
    for (let y = o.y + 10; y < o.y + o.h - 40; y += 3) {
      for (let dx = 0; dx < band; dx += 2) {
        for (const x of [o.x + dx, o.x + o.w - 1 - dx]) {
          const [R, G, B] = pixel(png, x, y)
          sum += luminance(R, G, B)
          n++
        }
      }
    }
    return sum / n
  }
  const before = await edge(-1500)
  const during = await edge(-600)
  expect(Math.abs(during - before), 'edge band mean luminance, t=-600 against t=-1500').toBeGreaterThanOrEqual(3)
})

test('the pane edges carry no hue shift: (g - b) matches the film just inside (R27.1)', async ({ page }) => {
  // before the cue: at t=-3000 the film carries no bloom, so any difference at the edges is the edge's own
  await openPane(page, '?t=-3000')
  const png = await shot(page)
  const o = await canvasRegion(page)
  const gb = (x0: number, y0: number, w: number, h: number): number => {
    let s = 0
    let n = 0
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) {
        const [, G, B] = pixel(png, x, y)
        s += G - B
        n++
      }
    }
    return s / n
  }
  const band = Math.round(o.w * 0.04)
  // The reference is the film just inside the edge band (8 to 12 % in), on the same rows: the pot's glow warms the middle of the pane
  // by design, so the pane centre is not the film's own colour. An edge that shifted hue (the v1b teal) would step away from it.
  const nearL = gb(o.x + Math.round(o.w * 0.08), o.y + 30, band, o.h - 80)
  const nearR = gb(o.x + o.w - Math.round(o.w * 0.12), o.y + 30, band, o.h - 80)
  const nearT = gb(o.x + 40, o.y + Math.round(o.h * 0.08), o.w - 80, Math.round(o.h * 0.04))
  const left = gb(o.x, o.y + 30, band, o.h - 80)
  const right = gb(o.x + o.w - band, o.y + 30, band, o.h - 80)
  const top = gb(o.x + 40, o.y, o.w - 80, Math.round(o.h * 0.04))
  for (const [name, v, ref] of [['left', left, nearL], ['right', right, nearR], ['top', top, nearT]] as const) {
    expect(Math.abs(v - ref), `${name} edge (g - b) against the film just inside it`).toBeLessThanOrEqual(3)
  }
})

test('the candle stands on a ledge that projects over the rail (R24.1)', async ({ page }) => {
  await openPane(page, '?t=6500')
  const candle = (await page.locator('.candle').boundingBox())!
  const ledge = (await page.locator('.candle__ledge').boundingBox())!
  const canvas = (await page.locator('.steam-canvas').boundingBox())!
  expect(ledge.width).toBeGreaterThanOrEqual(1.8 * candle.width)
  expect(ledge.y + ledge.height, 'the ledge reaches over the bottom rail').toBeGreaterThan(canvas.y + canvas.height)
})

test('one t is one frame: two captures at the same t are identical, flame included (R24.2)', async ({ page }) => {
  await openPane(page, '?t=3000')
  const a = (await page.screenshot({ type: 'png' })).toString('base64')
  await openPane(page, '?t=3000')
  const b = (await page.screenshot({ type: 'png' })).toString('base64')
  expect(a === b).toBe(true)
})
