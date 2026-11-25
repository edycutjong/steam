// cook-mode-qa-r1 Q5 and Q6: the phone (Pixel 5, 393 x 727 CSS px, and 390 x 844) in Cook Mode and on the shelf.
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, DEEP_LINK, openShelf, wipe } from './helpers/cook.ts'

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!

test.describe('Q5 Pixel 5 Cook Mode, held note at the last step', () => {
  test.use({ viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await page.goto(DEEP_LINK)
    await page.reload()
    await expect(cookRoot(page)).toHaveAttribute('data-note-state', 'held', { timeout: 40_000 })
    await page.waitForTimeout(700)
  })

  test('the step text is not cut by the control bar: the first lines show without scrolling, the last line clears the bar, no box of its own to scroll', async ({ page }) => {
    const bar = await box(page, '.controls')
    const text = await box(page, '.step__text')
    const lineH = await page.locator('.step__text').evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
    // at least three lines of the step stand above the bar before any scroll
    expect(text.y + 3 * lineH, 'three lines above the bar').toBeLessThanOrEqual(bar.y)
    // the text is whole: no inner scroll box on a phone
    const inner = await page.locator('.step__scroll').evaluate((e) => ({ over: e.scrollHeight - e.clientHeight, y: getComputedStyle(e).overflowY }))
    expect(inner.over).toBeLessThanOrEqual(4) // sub-pixel line rounding
    expect(inner.y).toBe('visible')
    expect(text.height).toBeGreaterThanOrEqual(3 * lineH)
    // scrolled to the end, the last line is clear of the bar with room to spare
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(200)
    const barAfter = await box(page, '.controls')
    const textAfter = await box(page, '.step__text')
    expect(textAfter.y + textAfter.height).toBeLessThanOrEqual(barAfter.y - 8)
    // the timer and the knob are reachable too
    for (const sel of ['.timer', '[role="slider"]']) expect((await box(page, sel)).y + (await box(page, sel)).height, sel).toBeLessThanOrEqual(barAfter.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('the ×12 pace badge is off the moon, at the top left of the pane', async ({ page }) => {
    const badge = await box(page, '.badge')
    const moon = await box(page, '.pane:not(.pane--leaving) .moon')
    const overlap = badge.x < moon.x + moon.width && badge.x + badge.width > moon.x && badge.y < moon.y + moon.height && badge.y + badge.height > moon.y
    expect(overlap, 'badge over moon').toBe(false)
    const stage = await box(page, '.stage')
    expect(badge.x + badge.width / 2).toBeLessThan(stage.x + stage.width / 2)
    expect(badge.y).toBeLessThan(stage.y + stage.height / 3)
  })

  test('the archive slip and the credit run together, "Started at" and "Start again" are one row, under the pane; every provenance field stays', async ({ page }) => {
    const stage = await box(page, '.stage')
    const under = await box(page, '.cook__under')
    expect(under.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1)
    expect(under.height, 'meta block under the pane').toBeLessThanOrEqual(112)
    const text = (await page.locator('.cook__under').innerText()).replace(/\s+/g, ' ')
    for (const f of ['Wellcome Collection', 'MS.1810', 'P.23', 'c. 1750', 'Public Domain Mark', 'Started at step 5 of 5', 'Start again']) expect(text.toLowerCase(), f).toContain(f.toLowerCase())
    // one row: the caption and its button share a baseline row
    const cap = await box(page, '.cook__caption span')
    const again = await box(page, '.cook__caption button')
    expect(Math.abs(cap.y + cap.height / 2 - (again.y + again.height / 2))).toBeLessThan(12)
    expect(again.height).toBeGreaterThanOrEqual(44)
    // the provenance link is still there and the Wipe control still 48 px
    // a2a-arch-r05 B10: the slip now has two links, the licence and "verify at source", so the licence link is named by its href
    await expect(page.locator('.cook__under .slip a:not(.slip__verify)')).toHaveAttribute('href', /creativecommons\.org/)
    await expect(page.locator('.cook__under .slip a.slip__verify')).toHaveAttribute('href', /\/full\/0\/default\.jpg$/)
    const w = await wipe(page).boundingBox()
    expect(w!.height).toBeGreaterThanOrEqual(48)
  })
})

// Q6: the shelf is a composed hero for its one recipe
async function heroChecks(page: Page, vw: number, vh: number, minThumb: number) {
  await openShelf(page)
  await page.locator('.shelf__thumb img').evaluate((i) => (i as HTMLImageElement).decode())
  const card = page.locator('.shelf__item').first()
  const thumb = (await card.locator('.shelf__thumb .mat').boundingBox())!
  const img = (await card.locator('.shelf__thumb img').boundingBox())!
  expect(thumb.width, 'mat width').toBeGreaterThanOrEqual(minThumb)
  expect(img.width, 'scan width').toBeGreaterThanOrEqual(minThumb - 40)
  for (const name of ['Cook it', 'Watch it at ×12']) {
    const b = (await card.getByRole('button', { name }).boundingBox())!
    expect(b.y + b.height, `${name} above the fold`).toBeLessThanOrEqual(vh)
    expect(b.x + b.width).toBeLessThanOrEqual(vw)
    expect(b.height).toBeGreaterThanOrEqual(48)
  }
  expect(await card.locator('.shelf__title').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('IM Fell English')
  const title = (await card.locator('.shelf__title').boundingBox())!
  expect(title.y + title.height).toBeLessThanOrEqual(vh)
  await expect(card.locator('.slip')).toContainText('MS.1810')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  return { card: (await card.boundingBox())! }
}

test.describe('Q6 shelf hero, phone 390 x 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  test('a bigger scan on its paper mat, the title, the slip and both buttons above the fold', async ({ page }) => {
    await heroChecks(page, 390, 844, 160)
  })
})

test.describe('Q6 shelf hero, desktop 1280 x 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('the card fills the width, with a scan of at least 380 px on its mat and both buttons above the fold', async ({ page }) => {
    const { card } = await heroChecks(page, 1280, 800, 380)
    expect(card.width).toBeGreaterThanOrEqual(1280 * 0.85)
    const body = (await page.locator('.shelf__body').boundingBox())!
    expect(body.x + body.width, 'the text column reaches the right side').toBeGreaterThanOrEqual(1280 * 0.85)
  })
})
