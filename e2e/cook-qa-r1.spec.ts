// cook-mode-qa-r1: the reviewer's findings, driven in the production build.
import { expect, test } from '@playwright/test'
import { cookRoot, openShelf, waitWipe, wipe } from './helpers/cook.ts'

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
