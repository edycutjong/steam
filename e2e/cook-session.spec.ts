// R27.5 to R27.8: sleep through a due time, restore after a reload, the phone, and bundles that cannot be shown.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, marks, openShelf, waitWipe, wipe } from './helpers/cook.ts'


const bundleText = readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')
const setVisibility = (page: Page, v: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, v)

test('sleep: a 60 s check time set on this device, a 10 minute sleep, exactly one reveal on waking and the full time on the clock', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.install()
  await openShelf(page) // the app opens IndexedDB "steam" and creates its stores
  // a cook-set check time (no manuscript time exists, design 12): 60 s on when-tender, written as the app's stepper writes it
  await page.evaluate(() => new Promise<void>((res, rej) => {
    const r = indexedDB.open('steam', 1)
    r.onsuccess = () => {
      const t = r.result.transaction('timing', 'readwrite')
      t.objectStore('timing').put({ key: 'quinces-marmalade\u0000when-tender', recipeId: 'quinces-marmalade', noteId: 'when-tender', seconds: 60 })
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    }
    r.onerror = () => rej(r.error)
  }))
  await page.goto('/#/r/quinces-marmalade/cook?note=when-tender&lead=0')
  await page.reload()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(root).toHaveAttribute('data-step', '4')
  await expect(root).toHaveAttribute('data-note-state', 'pending')
  await setVisibility(page, 'hidden')
  await page.clock.fastForward('10:00')
  // Playwright's installed clock replaces window.performance, so the marks cannot be read here. One applied reveal fires one
  // lamp dip (data-dips) and adds the note to data-revealed; both are read instead.
  const lamp = page.locator('.lamp')
  expect(await lamp.getAttribute('data-dips')).toBeNull()
  await expect(root).toHaveAttribute('data-revealed', '')
  await setVisibility(page, 'visible')
  await expect(root).toHaveAttribute('data-revealed', 'when-tender', { timeout: 10_000 })
  await expect(lamp).toHaveAttribute('data-dips', '1')
  await page.clock.runFor(5000)
  await expect(lamp).toHaveAttribute('data-dips', '1')
  await expect(root).toHaveAttribute('data-revealed', 'when-tender')
  const shown = await page.locator('.timer').innerText()
  const [m] = shown.split(':').map(Number)
  expect(m, `timer ${shown}`).toBeGreaterThanOrEqual(10)
})

test('restore: a reload at step 4 brings back the step, the pace and the held note without a second write-on; "Cook it" starts at step 1', async ({ page }) => {
  test.setTimeout(120_000)
  await openShelf(page)
  await page.getByRole('button', { name: 'Cook it' }).click()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await page.locator('[role="slider"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(root).toHaveAttribute('data-pace', '4')
  for (const label of ['Wipe the glass', 'Next step', 'Next step']) {
    await waitWipe(page, label)
    await wipe(page).click()
    await page.waitForTimeout(450)
  }
  await expect(root).toHaveAttribute('data-step', '4')
  await expect(root).toHaveAttribute('data-note-state', 'held', { timeout: 20_000 })
  await page.reload()
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(root).toHaveAttribute('data-step', '4')
  await expect(root).toHaveAttribute('data-pace', '4')
  await expect(root).toHaveAttribute('data-note-state', 'held')
  await expect(page.locator('.cook__caption')).toContainText('Resumed at step 4 of 5')
  await page.waitForTimeout(1500)
  expect(await marks(page, 'cook:write-on:when-tender')).toBe(0)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Cook it' }).click()
  await expect(root).toHaveAttribute('data-step', '1')
})

test.describe('phone 390 x 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('the first card is above the fold; Cook Mode has no horizontal scroll, a 48 px Wipe control and 24 px step text', async ({ page }) => {
    await openShelf(page)
    const card = page.locator('.shelf__item').first()
    for (const sel of ['.shelf__title', '.slip', 'button:has-text("Cook it")', 'button:has-text("Watch it at ×12")']) {
      const b = (await card.locator(sel).first().boundingBox())!
      expect(b.y + b.height, sel).toBeLessThanOrEqual(844)
    }
    await card.getByRole('button', { name: 'Cook it' }).click()
    await expect(cookRoot(page)).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const w = (await wipe(page).boundingBox())!
    expect(w.width).toBeGreaterThanOrEqual(48)
    expect(w.height).toBeGreaterThanOrEqual(48)
    const size = await page.locator('.step__text').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    expect(size).toBeGreaterThanOrEqual(24)
  })
})

test('an invalid recipe.json shows no card', async ({ page }) => {
  await page.route('**/recipes/quinces-marmalade/recipe.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"quinces-marmalade"}' }))
  await page.goto('/#/')
  await expect(page.getByText('No recipe could be loaded.')).toBeVisible()
  await expect(page.locator('.shelf__item')).toHaveCount(0)
})

test('a note with an unsupported licence is withheld: the edition says so and the step has no note', async ({ page }) => {
  const b = JSON.parse(bundleText)
  b.notes.find((n: { id: string }) => n.id === 'when-tender').provenance.licence.id = 'cc-by-nc'
  await page.route('**/recipes/quinces-marmalade/recipe.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) }))
  await page.goto('/#/r/quinces-marmalade')
  await expect(page.getByText('1 note withheld: the source of the note could not be checked.')).toBeVisible()
  await expect(page.locator('[data-line="07"]')).toContainText('the Quince, in that Liquor, & when')
  await page.goto('/#/r/quinces-marmalade/quoted')
  await expect(page.locator('.quote')).toHaveCount(2)
  await page.goto('/#/r/quinces-marmalade/cook?note=when-tender')
  await page.reload()
  await expect(cookRoot(page)).toHaveAttribute('data-step', '1')
  await expect(page.locator('.cook__caption')).toHaveText('That note is not on this page. Started at step 1 of 5.')
})
