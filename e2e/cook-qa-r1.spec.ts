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
