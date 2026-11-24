// R27.1, R27.2: the judge's path through the product, and the x12 walk through every row of the Wipe table.
import { expect, test } from '@playwright/test'
import { axe, bundle, cookRoot, DEEP_LINK, HERO, liveText, marks, markTime, openShelf, recordOrigins, regionUrlFor, waitMark, waitWipe, wipe } from './helpers/cook.ts'

test.use({ viewport: { width: 1280, height: 800 } })

test('main flow: shelf, edition, the deep link reveals by itself within 10 s, wipe to "The hand, quoted", verify links', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  const foreign = recordOrigins(page, baseURL!)
  await openShelf(page)
  const card = page.locator('.shelf__item')
  await expect(card).toHaveCount(1)
  await expect(card.locator('.slip')).toContainText('MS.1810')
  await expect(card.getByRole('button', { name: 'Cook it' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Watch it at ×12' })).toBeVisible()
  await expect(page.getByText(/upload|add a page/i)).toHaveCount(0)
  await axe(page)

  await card.getByRole('link', { name: 'To make Marmalade of Quinces' }).click()
  await expect(page.locator('h1')).toHaveText('To make Marmalade of Quinces')
  const markers = page.locator('.transcription .mark')
  await expect(markers).toHaveCount(bundle.transcription.disagreements.length)
  for (const m of await markers.all()) {
    const id = await m.getAttribute('aria-describedby')
    await expect(page.locator(`#${id}`)).toHaveText('Two independent readers disagree on this word. The hand is shown as written.')
  }
  await expect(page.locator('.moment-btn', { hasText: 'with its step' })).toHaveCount(3)
  await page.getByRole('button', { name: 'Read the provenance' }).click()
  await expect(page.getByText('Reviewed by: Claude Code builder agent (autopilot P1b), not a human, 2026-11-25')).toBeVisible()
  await axe(page)

  await page.goto(DEEP_LINK)
  await page.reload() // a hash change alone does not reload; the judge opens the link fresh
  const ready = await waitMark(page, 'cook:ready')
  const reveal = await waitMark(page, `cook:reveal:${HERO}`, 20_000)
  console.log(`deep link: cook:ready ${ready.toFixed(0)} ms after navigation, reveal ${(reveal - ready).toFixed(0)} ms after cook:ready`)
  expect(reveal - ready).toBeLessThanOrEqual(10_000)
  await expect(page.locator('.badge')).toHaveText('×12 pace')
  await expect.poll(() => liveText(page)).toContain("The writer's note, handwritten: till it Looks red & smooth")
  await waitWipe(page, 'The hand, quoted')
  await axe(page)
  await wipe(page).click()

  await expect(page.locator('h1')).toHaveText('The hand, quoted', { timeout: 10_000 })
  const rows = page.locator('.quote')
  await expect(rows).toHaveCount(3)
  await expect(rows.locator('.quote__step')).toHaveText(['Step 1', 'Step 4', 'Step 5'])
  const href = await page.locator(`.quote[data-note="${HERO}"] a.verify`).getAttribute('href')
  expect(href).toBe(regionUrlFor(HERO))
  expect(href).toMatch(/\/b18419665_MS_1810_0033\.JP2\/\d+,\d+,\d+,\d+\/full\/0\/default\.jpg$/)
  for (const n of bundle.notes) expect(await page.locator(`.quote[data-note="${n.id}"] a.verify`).getAttribute('href')).toBe(regionUrlFor(n.id))
  await expect(page.locator('.quoted__foot .credit-line')).toHaveText('Wellcome Collection, Public Domain Mark')
  await axe(page)
  await page.getByRole('button', { name: 'Cook again' }).click()
  await expect(cookRoot(page)).toHaveAttribute('data-step', '1')
  expect(foreign, 'requests to another origin').toEqual([])
})

test('watch at x12: the badge throughout, and every row of the Wipe table', async ({ page }) => {
  test.setTimeout(120_000)
  await openShelf(page)
  await page.getByRole('button', { name: 'Watch it at ×12' }).click()
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  const badge = page.locator('.badge')
  await expect(badge).toHaveText('×12 pace')
  const box = await wipe(page).boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(48)
  expect(box!.height).toBeGreaterThanOrEqual(48)
  const seen: string[] = []
  for (let step = 1; step <= 5; step++) {
    await expect(root).toHaveAttribute('data-step', String(step))
    await expect(badge).toHaveText('×12 pace')
    const label = step === 1 || step === 4 ? 'Wipe the glass' : step === 5 ? 'The hand, quoted' : 'Next step'
    await waitWipe(page, label)
    if (step === 2 || step === 3) {
      // a step without a note: the glass stays fogged over the next note; nothing of it has been revealed
      await expect(root).toHaveAttribute('data-note-state', 'none')
      expect(await marks(page, 'cook:reveal:when-tender')).toBe(0)
      await expect(page.locator('section.pane:not(.pane--leaving)')).toHaveAttribute('data-note', 'when-tender')
    } else {
      await expect(root).toHaveAttribute('data-note-state', 'held')
    }
    seen.push(`${step}:${label}`)
    await wipe(page).click()
    await page.waitForTimeout(450) // a second press within 400 ms is ignored by design (R14.6)
  }
  await expect(page.locator('h1')).toHaveText('The hand, quoted', { timeout: 10_000 })
  expect(seen).toEqual(['1:Wipe the glass', '2:Next step', '3:Next step', '4:Wipe the glass', '5:The hand, quoted'])
})

test('"Show the note" at a pending note starts the write-on at once; a drag across the held pane advances', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/#/r/quinces-marmalade/cook?note=when-tender&lead=60')
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(wipe(page)).toHaveText('Show the note')
  await expect(root).toHaveAttribute('data-note-state', 'pending')
  await wipe(page).click()
  const t0 = await page.evaluate(() => performance.now())
  const w = await waitMark(page, 'cook:write-on:when-tender', 5_000)
  expect(w - t0).toBeLessThan(1_000)
  await expect(root).toHaveAttribute('data-note-state', 'held', { timeout: 15_000 })
  const b = (await page.locator('.stage').boundingBox())!
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (0.15 + 0.05 * i), b.y + b.height * 0.6)
  await page.mouse.up()
  await expect(root).toHaveAttribute('data-step', '5')
  expect(await markTime(page, 'cook:reveal:when-tender')).not.toBeNull()
})
