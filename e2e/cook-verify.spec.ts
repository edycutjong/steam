// a2a-arch-r05 B10: at the hold in Cook Mode the compact slip links the same pixels as "The hand, quoted" does for that note.
import { expect, test } from '@playwright/test'
import { axe, DEEP_LINK, HERO, regionUrlFor, waitWipe, wipe } from './helpers/cook.ts'

for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`${vp.name}: the slip's verify link at the hold equals the Quoted page's link for the note`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(DEEP_LINK)
    await page.reload()
    await waitWipe(page, 'The hand, quoted')
    const link = page.locator('.cook__under .slip a.slip__verify')
    await expect(link).toHaveCount(1)
    const href = await link.getAttribute('href')
    expect(href).toBe(regionUrlFor(HERO))
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toBeVisible()
    const box = (await link.boundingBox())!
    const view = page.viewportSize()!
    expect(box.x, 'inside the viewport on the left').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'inside the viewport on the right').toBeLessThanOrEqual(view.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll').toBe(true)
    await axe(page)
    await wipe(page).click()
    await expect(page.locator('h1')).toHaveText('The hand, quoted', { timeout: 10_000 })
    expect(await page.locator(`.quote[data-note="${HERO}"] a.verify`).getAttribute('href')).toBe(href)
  })
}
