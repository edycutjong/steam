// steam-renderer-v1 R6, R7, R9.5: the night view, the candle, the haunting cue's DOM side and the governor's readout.
import { expect, test } from '@playwright/test'
import { heroUrl } from './helpers/hero.ts'
import { VIEWPORTS, openPane } from './helpers/pane.ts'

test.use({ viewport: VIEWPORTS.desktop })

test('the upper sash is split into two panes and shows a night: stars, moon, branches, cloud; the sill has a candle', async ({ page }) => {
  await openPane(page, '?t=6500')
  await expect(page.locator('.sash--upper svg.night')).toHaveCount(1)
  await expect(page.locator('.sash--upper .muntin')).toHaveCount(1)
  expect(await page.locator('.night__stars circle').count()).toBeGreaterThanOrEqual(15)
  await expect(page.locator('.sash--upper .moon')).toHaveCount(1)
  expect(await page.locator('.night__branches path').count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('.night__cloud-haunt')).toHaveCount(1)
  await expect(page.locator('.sash--upper image')).toHaveCount(0)
  const muntin = (await page.locator('.muntin').boundingBox())!
  const sash = (await page.locator('.sash--upper').boundingBox())!
  expect(Math.abs(muntin.x + muntin.width / 2 - (sash.x + sash.width / 2))).toBeLessThan(2)
  // the candle stands on the sill: its base is the glass's bottom edge, its flame above it
  const candle = (await page.locator('.candle').boundingBox())!
  const glass = (await page.locator('.sash--lower').boundingBox())!
  expect(Math.abs(candle.y + candle.height - (glass.y + glass.height))).toBeLessThan(2)
  expect(await page.locator('.candle__flame').count()).toBe(1)
})

test('the cue: calm before the reveal, gather while the hand is written, clear once it holds', async ({ page }) => {
  for (const [t, want] of [
    [-5000, 'calm'],
    [-600, 'gather'],
    [2500, 'gather'],
    [6500, 'clear'],
  ] as const) {
    await openPane(page, `?t=${t}`)
    await expect(page.locator('.sash--upper')).toHaveAttribute('data-haunt', want)
    await expect(page.locator('.candle')).toHaveAttribute('data-haunt', want)
  }
})

test('the cloud slides over the moon during the cue and the candle leans (CSS), and both are still under reduced motion', async ({ page }) => {
  await openPane(page, '?t=2500')
  const moving = await page.evaluate(() => {
    const cloud = getComputedStyle(document.querySelector('.night__cloud-haunt')!)
    const flame = getComputedStyle(document.querySelector('.candle__flame')!)
    return { cloud: cloud.transform, cloudT: cloud.transitionDuration, flameAnim: flame.animationName, rotate: flame.rotate }
  })
  expect(moving.cloudT).toBe('1.2s')
  expect(moving.flameAnim).not.toBe('none')
  expect(moving.rotate).not.toBe('none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(heroUrl('?t=2500'))
  await page.locator('.sash--upper').waitFor()
  const still = await page.evaluate(() => {
    const cloud = getComputedStyle(document.querySelector('.night__cloud-haunt')!)
    const drift = getComputedStyle(document.querySelector('.night__cloud-drift')!)
    const flame = getComputedStyle(document.querySelector('.candle__flame')!)
    return { cloud: cloud.transform, cloudT: cloud.transitionDuration, drift: drift.animationName, flameAnim: flame.animationName, rotate: flame.rotate }
  })
  expect(still.flameAnim).toBe('none')
  expect(still.drift).toBe('none')
  expect(still.cloud).toBe('none')
  expect(still.cloudT).toBe('0s')
  expect(still.rotate).toBe('none')
})

test('the governor tier is on window.__steamStats and in the ?fps=1 overlay', async ({ page }) => {
  await openPane(page, '?fps=1&lead=0')
  await page.waitForTimeout(1500)
  const stats = await page.evaluate(() => (window as unknown as { __steamStats?: { tier: number; frames: number; renderer: string | null } }).__steamStats)
  expect(stats).toBeTruthy()
  expect(stats!.tier).toBe(0)
  expect(stats!.frames).toBeGreaterThan(5)
  await expect(page.locator('.fps')).toContainText('tier 0')
})
