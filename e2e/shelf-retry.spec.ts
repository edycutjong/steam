// a2a-arch-r06 C1: a deep link whose recipe failed on the network recovers without a reload.
import { expect, test } from '@playwright/test'

// the service worker would answer from its cache before page.route could fail the request
test.use({ serviceWorkers: 'block' })

test('a deep link that failed on transport offers "Try again", and the recipe replaces not-found on the same route', async ({ page }) => {
  let down = true
  await page.route('**/recipes/quinces-marmalade/recipe.json', (r) => (down ? r.fulfill({ status: 503, body: '' }) : r.continue()))
  await page.goto('/#/r/quinces-marmalade')
  await expect(page.locator('h1')).toHaveText('This recipe is not on the shelf', { timeout: 15_000 }) // three attempts, 300 ms and 1 s apart
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByText('The recipe did not load. Check the connection.')).toBeVisible()
  // the button is keyboard operable
  down = false
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('To make Marmalade of Quinces')
  expect(new URL(page.url()).hash).toBe('#/r/quinces-marmalade')
})

test('the browser coming back online loads the recipe by itself', async ({ page }) => {
  let down = true
  await page.route('**/recipes/quinces-marmalade/recipe.json', (r) => (down ? r.abort('connectionreset') : r.continue()))
  await page.goto('/#/r/quinces-marmalade')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 15_000 })
  down = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('h1')).toHaveText('To make Marmalade of Quinces')
})

test('a 404 stays the plain not-found screen: no line, no button', async ({ page }) => {
  await page.route('**/recipes/quinces-marmalade/recipe.json', (r) => r.fulfill({ status: 404, body: '' }))
  await page.goto('/#/r/quinces-marmalade')
  await expect(page.locator('h1')).toHaveText('This recipe is not on the shelf')
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await expect(page.getByText('The recipe did not load.')).toHaveCount(0)
})
