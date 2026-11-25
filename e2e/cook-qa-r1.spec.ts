// cook-mode-qa-r1: the reviewer's findings, driven in the production build.
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, DEEP_LINK, liveText, openShelf, waitWipe, wipe } from './helpers/cook.ts'

test.use({ viewport: { width: 1280, height: 800 } })

test('Q2: while the hand is written the button says so and is aria-disabled; "Wipe the glass" only once the note is held', async ({ page }) => {
  await openShelf(page)
  await page.getByRole('button', { name: 'Cook it' }).click()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  // arrival at real time: the first note is revealed with its step and written on the glass
  await expect(root).toHaveAttribute('data-note-state', 'writing', { timeout: 10_000 })
  await expect(wipe(page)).toHaveText('The hand is writing…')
  await expect(wipe(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(wipe(page)).toBeFocused()
  // pressing it does nothing
  await wipe(page).click({ force: true }) // a plain click would wait for it to be enabled
  await expect(root).toHaveAttribute('data-step', '1')
  await expect(wipe(page)).not.toHaveText('Wipe the glass')
  await waitWipe(page, 'Wipe the glass')
  await expect(root).toHaveAttribute('data-note-state', 'held')
})

test('Q1: at ×12 the clock says it is cooking time at ×12 in its text and its accessible name', async ({ page }) => {
  await openShelf(page)
  await page.getByRole('button', { name: 'Watch it at ×12' }).click()
  await expect(cookRoot(page)).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  const timer = page.locator('.timer')
  await expect(timer).toContainText('cooking time at ×12')
  await expect(timer).toHaveAttribute('aria-label', /^\d+:\d\d, cooking time at ×12$/)
  await expect(page.getByRole('timer', { name: /cooking time at ×12/ })).toBeVisible()
})

test('Q3: "Two independent readers disagree" is never free text: only on a † step, hidden, reached through the † spans', async ({ page }) => {
  const PHRASE = 'Two independent readers disagree'
  await openShelf(page)
  await page.getByRole('button', { name: 'Watch it at ×12' }).click()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(root).toHaveAttribute('data-step', '1')
  await expect(page.locator('.step .mark')).toHaveCount(0)
  await expect(page.locator('#disagree-desc')).toHaveCount(0)
  expect(await page.locator('body').ariaSnapshot()).not.toContain(PHRASE)
  await waitWipe(page, 'Wipe the glass')
  await wipe(page).click()
  await expect(root).toHaveAttribute('data-step', '2')
  expect(await page.locator('.step .mark').count()).toBeGreaterThan(0)
  await expect(page.locator('#disagree-desc')).toBeHidden()
  await expect(page.locator('#disagree-desc')).toHaveText(`${PHRASE} on this word. The hand is shown as written.`)
  for (const m of await page.locator('.step .mark').all()) await expect(m).toHaveAttribute('aria-describedby', 'disagree-desc')
  expect(await page.locator('body').ariaSnapshot()).not.toContain(PHRASE)
  expect(await page.locator('[aria-describedby="disagree-desc"]:not(.mark)').count()).toBe(0)
  // the quoted screen: no † in the quoted words, so no description at all
  await page.goto('/#/r/quinces-marmalade/quoted')
  await expect(page.locator('h1')).toHaveText('The hand, quoted')
  await expect(page.locator('#disagree-desc')).toHaveCount(0)
  expect(await page.locator('body').ariaSnapshot()).not.toContain(PHRASE)
})

async function loseContext(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const c = document.querySelector('section.pane:not(.pane--leaving) canvas.steam-canvas') as HTMLCanvasElement | null
    const gl = c?.getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    return true
  })
  expect(ok, 'the live canvas has a WebGL2 context to lose').toBe(true)
}

test('Q8: a lost WebGL context falls back to StaticPane at the current phase: a held note stays shown, announced and wipeable', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(DEEP_LINK)
  await page.reload()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-note-state', 'held', { timeout: 40_000 })
  await expect.poll(() => liveText(page)).toContain("The writer's note, handwritten: till it Looks red & smooth")
  await expect(page.locator('section.pane canvas.steam-canvas')).toHaveCount(1)
  await loseContext(page)
  // not restored within 2 s: the static pane replaces the canvas
  await expect(page.locator('section.pane .static-pane')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.locator('section.pane canvas.steam-canvas')).toHaveCount(0)
  await page.waitForTimeout(1500)
  // the held image is the one showing (opacity 1) and the control still says the note is held
  const imgs = page.locator('section.pane .static-pane img')
  await expect(imgs).toHaveCount(3)
  await expect(imgs.nth(1)).toHaveCSS('opacity', '1')
  await expect(imgs.nth(2)).toHaveCSS('opacity', '0')
  await expect(root).toHaveAttribute('data-note-state', 'held')
  await expect(wipe(page)).toHaveText('The hand, quoted')
  await expect(wipe(page)).not.toHaveAttribute('aria-disabled', 'true')
  expect(await liveText(page)).toContain("The writer's note, handwritten: till it Looks red & smooth")
  // and it can still be wiped: the sweep runs, then "The hand, quoted"
  await wipe(page).click()
  await expect(imgs.nth(2)).toHaveCSS('opacity', '1', { timeout: 5000 })
  await expect(page.locator('h1')).toHaveText('The hand, quoted', { timeout: 10_000 })
})

test('Q8: a context lost while the note is being written: the static pane carries on and the note is held', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(DEEP_LINK)
  await page.reload()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-note-state', 'writing', { timeout: 40_000 })
  await loseContext(page)
  await expect(page.locator('section.pane .static-pane')).toHaveCount(1, { timeout: 10_000 })
  await expect(root).toHaveAttribute('data-note-state', 'held', { timeout: 15_000 })
  await waitWipe(page, 'The hand, quoted')
  await expect(page.locator('section.pane .static-pane img').nth(1)).toHaveCSS('opacity', '1')
})
