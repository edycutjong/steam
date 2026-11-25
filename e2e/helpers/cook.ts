// Helpers for the Cook Mode specs: marks, the live region, the region URL from the test's own arithmetic, axe.
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const RECIPE = 'quinces-marmalade'
export const HERO = 'till-it-looks-red-smooth'
export const DEEP_LINK = `/#/r/${RECIPE}/cook?note=${HERO}&pace=12`

interface Bundle {
  source: { imageService: string; canvas: { width: number; height: number }; frame: { width: number; height: number } }
  notes: { id: string; step: number; span: string; verifyBox: [number, number, number, number] }[]
  transcription: { disagreements: unknown[] }
}
export const bundle: Bundle = JSON.parse(readFileSync(`public/recipes/${RECIPE}/recipe.json`, 'utf8'))

/** The IIIF region URL of a note, by the arithmetic of R21.4 written out here (not imported from the app). */
export function regionUrlFor(noteId: string): string {
  const n = bundle.notes.find((x) => x.id === noteId)!
  const { canvas: c, frame: f, imageService } = bundle.source
  const [vx, vy, vw, vh] = n.verifyBox
  const x = Math.max(0, Math.floor((vx * c.width) / f.width))
  const y = Math.max(0, Math.floor((vy * c.height) / f.height))
  const x1 = Math.min(c.width, Math.ceil(((vx + vw) * c.width) / f.width))
  const y1 = Math.min(c.height, Math.ceil(((vy + vh) * c.height) / f.height))
  return `${imageService}/${x},${y},${x1 - x},${y1 - y}/full/0/default.jpg`
}

export async function openShelf(page: Page): Promise<void> {
  await page.goto('/#/')
  await page.locator('.shelf__item').first().waitFor()
}

/** startTime of the first mark with this name, or null. */
export async function markTime(page: Page, name: string): Promise<number | null> {
  return page.evaluate((n) => performance.getEntriesByName(n)[0]?.startTime ?? null, name)
}
export async function waitMark(page: Page, name: string, timeout = 30_000): Promise<number> {
  await page.waitForFunction((n) => performance.getEntriesByName(n).length > 0, name, { timeout })
  return (await markTime(page, name))!
}
export const marks = (page: Page, name: string): Promise<number> => page.evaluate((n) => performance.getEntriesByName(n).length, name)

export const liveText = (page: Page): Promise<string> => page.locator('[role="status"]').innerText()

/** The axe rules of R23.7 on the current screen. */
export async function axe(page: Page): Promise<void> {
  const r = await new AxeBuilder({ page }).withRules(['color-contrast', 'button-name', 'link-name', 'image-alt', 'aria-valid-attr', 'aria-required-attr', 'label']).analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

/** Records every request; the flow may only talk to the app's own origin (R2.6). */
export function recordOrigins(page: Page, base: string): string[] {
  const foreign: string[] = []
  const own = new URL(base).origin
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.protocol.startsWith('http') && u.origin !== own) foreign.push(r.url())
  })
  return foreign
}

export const cookRoot = (page: Page) => page.locator('main.cook')
export const wipe = (page: Page) => page.locator('button.wipe')
/** Waits until the Wipe control is not disabled (the write-on has finished) and its label is `label`. */
export async function waitWipe(page: Page, label: string, timeout = 20_000): Promise<void> {
  await expect(wipe(page)).toHaveText(label, { timeout })
  await expect(wipe(page)).not.toHaveAttribute('aria-disabled', 'true', { timeout })
  // .wipe fades its colours over 200 ms when it turns active: axe run in that window reads a mid-fade contrast (seen once in cook-flow)
  await page.waitForTimeout(250)
}
