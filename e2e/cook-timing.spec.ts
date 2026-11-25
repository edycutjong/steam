// cook-mode-qa-r1 Q4: the moment chip of each judgement line opens the per-note timing stepper (device-local, IndexedDB).
import { expect, test, type Page } from '@playwright/test'
import { axe, cookRoot, liveText, wipe } from './helpers/cook.ts'

test.use({ viewport: { width: 1280, height: 800 } })

const timingRows = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ noteId: string; seconds: number }[]>((res, rej) => {
        const r = indexedDB.open('steam')
        r.onsuccess = () => {
          const q = r.result.transaction('timing', 'readonly').objectStore('timing').getAll()
          q.onsuccess = () => res(q.result as { noteId: string; seconds: number }[])
          q.onerror = () => rej(q.error)
        }
        r.onerror = () => rej(r.error)
      }),
  )

test('every judgement line has a chip that opens the stepper: basis, set a time on this device, it survives a reload and Cook Mode holds the note until then', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/#/r/quinces-marmalade')
  await page.reload()
  const chips = page.locator('.moment-btn')
  await expect(chips).toHaveCount(3)
  const chip = chips.first()
  await expect(chip).toHaveAccessibleName('Change the moment of this note: full ripe, with its step')
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(chip).toContainText('with its step')
  await expect(page.getByText('Basis:')).toHaveCount(0)

  // opens by pointer and shows the basis with its source
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  const stepper = page.locator('.stepper:not([hidden])')
  await expect(stepper).toHaveCount(1)
  await expect(stepper).toContainText('Basis: the manuscript gives no time; the note arrives with its step')
  for (const name of ['Earlier', 'Later', "Reset to the manuscript's"]) {
    const box = await stepper.getByRole('button', { name }).boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
  await axe(page)

  // set 60 s on this device: the chip, the announcement, IndexedDB and the basis all say so
  await stepper.getByRole('button', { name: 'Later' }).click()
  await stepper.getByRole('button', { name: 'Later' }).click()
  await expect(chip).toContainText('check from 1 min · set by you')
  await expect(stepper).toContainText('Basis: set by you on this device')
  await expect.poll(() => liveText(page)).toBe('full ripe: check from 1 min · set by you')
  await expect.poll(() => timingRows(page)).toEqual([expect.objectContaining({ noteId: 'full-ripe', seconds: 60 })])

  // it survives a reload, and the stepper reopens by keyboard
  await page.reload()
  const again = page.getByRole('button', { name: /Change the moment of this note: full ripe, check from 1 min · set by you/ })
  await expect(again).toBeVisible()
  await again.focus()
  await page.keyboard.press('Enter')
  await expect(again).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.stepper:not([hidden])')).toContainText('Basis: set by you on this device')

  // Cook Mode at real time uses it: step 1's note waits for its check time instead of arriving with the step
  await page.getByRole('button', { name: 'Cook it' }).first().click()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(root).toHaveAttribute('data-step', '1')
  await expect(root).toHaveAttribute('data-note-state', 'pending')
  await expect(wipe(page)).toHaveText('Show the note')
  await page.waitForTimeout(2500)
  await expect(root).toHaveAttribute('data-note-state', 'pending')
  await expect(root).toHaveAttribute('data-revealed', '')

  // reset gives the manuscript's moment back and removes the device row
  await page.goto('/#/r/quinces-marmalade')
  await page.reload()
  await page.getByRole('button', { name: /Change the moment of this note: full ripe/ }).click()
  await page.getByRole('button', { name: "Reset to the manuscript's" }).click()
  await expect(page.getByRole('button', { name: /Change the moment of this note: full ripe, with its step/ })).toBeVisible()
  await expect.poll(() => timingRows(page)).toEqual([])
})
