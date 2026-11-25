// hero-hold-clearance R1: at the held state of the hero deep link the ink keeps 12 css px of clear glass from each shade band and the
// block is centred in the clear glass. Measured on the ink pixels (the note's own alpha mapped through the layout the page reports).
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { MIN_CORE_CSS_PX } from '../src/steam/layout.ts'
import { RECIPE } from './helpers/cook.ts'
import { canvasOrigin, readLayout } from './helpers/pane.ts'

const SHADE = 16
const CLEAR_CSS = 12
const NOTE = 'when-tender'
const link = `/#/r/${RECIPE}/cook?note=${NOTE}&pace=12`

const note = PNG.sync.read(readFileSync(`public/recipes/${RECIPE}/note-${NOTE}.png`))

async function openHeld(page: Page): Promise<void> {
  await page.goto(link)
  await page.reload()
  await page.waitForFunction(() => document.querySelector('main.cook')?.getAttribute('data-note-state') === 'held', undefined, { timeout: 40_000 })
  await page.waitForTimeout(900)
}

/** Screen pixels (relative to the pane) on the writer's ink: note alpha above 200 inside a group rect, through the reported layout. */
async function inkRows(page: Page): Promise<{ top: number; bottom: number; h: number }> {
  const [layout, o] = await Promise.all([readLayout(page), canvasOrigin(page)])
  let top = Infinity
  let bottom = -Infinity
  for (const g of layout.groups) {
    const [rx0, ry0, rx1, ry1] = g.rect!
    for (let ny = ry0; ny < ry1; ny++)
      for (let nx = rx0; nx < rx1; nx++) {
        if (note.data[(ny * note.width + nx) * 4 + 3] <= 200) continue
        const y = g.inked[1] + (ny - ry0 + 0.5) * g.scale
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
  }
  return { top, bottom, h: o.h }
}

test.describe('desktop 1280 x 720', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('the held hero note keeps 12 css px of clear glass above the bottom shade and below the top shade, and is centred', async ({ page }) => {
    await openHeld(page)
    const layout = await readLayout(page)
    expect(layout.kind).toBe('page')
    expect(layout.fits).toBe(true)
    for (const g of layout.groups) expect(g.coreBandCssPx, `group ${g.index} core band`).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
    const { top, bottom, h } = await inkRows(page)
    expect(h, 'the pane is the 209 px sash of the 720 px page').toBeGreaterThan(150)
    expect(h - bottom, 'clear glass between the lowest ink and the bottom of the pane').toBeGreaterThanOrEqual(SHADE + CLEAR_CSS)
    expect(top, 'clear glass between the top of the pane and the highest ink').toBeGreaterThanOrEqual(SHADE + CLEAR_CSS)
    // centred in the clear glass: ink pixels sit up to half a pixel inside their rects
    expect(Math.abs((top + bottom) / 2 - h / 2), 'block middle against the middle of the glass').toBeLessThanOrEqual(1.5)
  })
})

test.describe('Pixel 5, 393 x 851', () => {
  test.use({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true })

  test('the phone layout of the held hero note is the groups layout and keeps its core bands', async ({ page }) => {
    await openHeld(page)
    const layout = await readLayout(page)
    expect(layout.kind).toBe('groups')
    for (const g of layout.groups) expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
  })
})
