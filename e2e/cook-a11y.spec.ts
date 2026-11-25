// R27.3, R27.4: the same flow under reduced motion, and by keyboard alone.
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, DEEP_LINK, HERO, liveText, openShelf, waitMark, waitWipe, wipe } from './helpers/cook.ts'

test.use({ viewport: { width: 1280, height: 800 } })

test('reduced motion: no canvas, the held image fades in by opacity over 0.6 s, the same words, the lamp dips once', async ({ page }) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(DEEP_LINK.replace('pace=12', 'pace=12&lead=1'))
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('.static-pane')).toHaveCount(1)
  await waitMark(page, `cook:reveal:${HERO}`, 15_000)
  const held = page.locator('.static-pane img').nth(1)
  const t = await held.evaluate((e) => ({ p: getComputedStyle(e).transitionProperty, d: getComputedStyle(e).transitionDuration, tr: getComputedStyle(e).transform }))
  expect(t).toEqual({ p: 'opacity', d: '0.6s', tr: 'none' })
  await expect.poll(() => liveText(page)).toContain("The writer's note, handwritten: till it Looks red & smooth")
  const lamp = page.locator('.lamp')
  await expect(lamp).toHaveCount(1)
  await expect(lamp).toHaveAttribute('data-dips', '1')
  await expect.poll(() => lamp.evaluate((e) => (e as HTMLElement).style.opacity), { timeout: 3000 }).toBe('0')
  await page.waitForTimeout(3500)
  await expect(lamp).toHaveAttribute('data-dips', '1')
})

/** The focused element shows an outline of at least 2 px in --ghost. */
async function ringOk(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'nothing focused'
    const cs = getComputedStyle(el)
    const ok = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 && cs.outlineColor.replace(/\s/g, '') === 'rgb(188,211,228)'
    return ok ? 'ok' : `${el.tagName}.${el.className}: ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`
  })
}
async function tabTo(page: Page, match: (s: { tag: string; text: string; role: string | null }) => boolean, max = 40, back = false): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
    expect(await ringOk(page)).toBe('ok')
    const s = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement
      return { tag: e.tagName, text: (e.textContent ?? '').trim(), role: e.getAttribute('role') }
    })
    if (match(s)) return
  }
  throw new Error('tabTo: target not reached')
}

test('keyboard only: Tab and Enter from the shelf to the edition and Cook Mode; arrows on the knob; Space and Enter to "The hand, quoted"; a ring on every stop', async ({ page }) => {
  test.setTimeout(120_000)
  await openShelf(page)
  await tabTo(page, (s) => s.tag === 'A' && s.text === 'To make Marmalade of Quinces')
  await page.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('To make Marmalade of Quinces')
  await tabTo(page, (s) => s.tag === 'BUTTON' && s.text === 'Cook it')
  await page.keyboard.press('Enter')
  const root = cookRoot(page)
  await expect(root).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  await expect(wipe(page)).toBeFocused()
  // the knob sits before the controls row
  await tabTo(page, (s) => s.role === 'slider', 6, true)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.badge')).toHaveText('×12 pace')
  await expect(root).toHaveAttribute('data-pace', '12')
  await tabTo(page, (s) => s.tag === 'BUTTON' && s.text !== '' && (s.text.includes('Wipe') || s.text.includes('Next') || s.text.includes('hand')), 6)
  const keys = ['Space', 'Enter']
  for (let step = 1; step <= 5; step++) {
    await expect(root).toHaveAttribute('data-step', String(step))
    await waitWipe(page, step === 5 ? 'The hand, quoted' : step === 2 || step === 3 ? 'Next step' : 'Wipe the glass')
    await expect(wipe(page), 'focus stays on the Wipe control across steps').toBeFocused()
    await page.keyboard.press(keys[step % 2]!)
    await page.waitForTimeout(450)
  }
  await expect(page.locator('h1')).toHaveText('The hand, quoted', { timeout: 10_000 })
  await tabTo(page, (s) => s.tag === 'A' && s.text.startsWith('verify at source'))
})
