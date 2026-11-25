// cook-mode-qa-r1 Q7: the Tab order follows the visual order on every screen (top to bottom, left to right within a row).
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, DEEP_LINK } from './helpers/cook.ts'

interface Stop {
  name: string
  top: number
  bottom: number
  left: number
}

/** Tabs from the top of the document (focus on nothing) until focus leaves the page or comes round; returns each stop in document coordinates. */
async function tabStops(page: Page, max = 60): Promise<Stop[]> {
  // a click at the top-left corner puts the browser's sequential-focus starting point there (an auto-focused control would otherwise be the start)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.click(2, 2)
  const stops: Stop[] = []
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body || el === document.documentElement) return null
      const r = el.getBoundingClientRect()
      let fixed = false
      for (let n: HTMLElement | null = el; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') fixed = true
      // a bar fixed to the bottom of the viewport reads, on the page, after everything that scrolls
      const shift = fixed ? document.documentElement.scrollHeight - window.innerHeight : window.scrollY
      const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
      return { name: label, top: r.top + shift, bottom: r.bottom + shift, left: r.left + window.scrollX, id: `${el.tagName}#${el.id}.${el.className}` }
    })
    if (!s) break
    if (stops.some((x) => x.name === s.name && x.top === s.top && x.left === s.left)) break
    stops.push(s)
  }
  return stops
}

/** a then b: b is not above a, and in the same row b is not left of a. */
function inVisualOrder(stops: Stop[], columns: { width: number; gridTop: number } | null = null): string[] {
  const bad: string[] = []
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!
    const b = stops[i]!
    if (columns && a.top >= columns.gridTop && b.top >= columns.gridTop) {
      // column-major, as the DOM reads: the whole left column, then the right one (the left one is sticky, so only its column counts)
      const ca = a.left < columns.width / 2 ? 0 : 1
      const cb = b.left < columns.width / 2 ? 0 : 1
      if (cb < ca) bad.push(`"${b.name}" (left column) is tabbed after "${a.name}" (right column)`)
      else if (ca === 1 && cb === 1 && b.top < a.top - 2) bad.push(`"${b.name}" (y ${Math.round(b.top)}) is tabbed after "${a.name}" (y ${Math.round(a.top)}) but sits above it`)
      continue
    }
    const sameRow = b.top < a.bottom - 2 && b.bottom > a.top + 2
    if (!sameRow && b.top < a.top - 2) bad.push(`"${b.name}" (y ${Math.round(b.top)}) is tabbed after "${a.name}" (y ${Math.round(a.top)}) but sits above it`)
    else if (sameRow && b.left < a.left - 2) bad.push(`"${b.name}" (x ${Math.round(b.left)}) is tabbed after "${a.name}" (x ${Math.round(a.left)}) but sits left of it`)
  }
  return bad
}

const profiles = [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 393, height: 727 }, true],
] as const

for (const [name, viewport, mobile] of profiles) {
  test.describe(`tab order, ${name}`, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile })

    test('shelf', async ({ page }) => {
      await page.goto('/#/')
      await page.reload()
      await page.locator('.shelf__item').first().waitFor()
      const stops = await tabStops(page)
      expect(stops.length).toBeGreaterThanOrEqual(3)
      expect(inVisualOrder(stops)).toEqual([])
    })

    test('edition', async ({ page }) => {
      await page.goto('/#/r/quinces-marmalade')
      await page.reload()
      await page.locator('.transcription').waitFor()
      const stops = await tabStops(page)
      console.log(`${name} edition:`, stops.map((s) => `${s.name} @${Math.round(s.left)},${Math.round(s.top)}`).join(' | '))
      expect(stops.length).toBeGreaterThanOrEqual(5)
      const gridTop = await page.locator('.edition__grid').evaluate((e) => e.getBoundingClientRect().top + window.scrollY)
      // above the grid (back link, title, "Cook it") the rule is rows; inside the desktop grid it is the scan column, then the text column
      expect(inVisualOrder(stops, name === 'desktop' ? { width: viewport.width, gridTop } : null)).toEqual([])
    })

    test('quoted', async ({ page }) => {
      await page.goto('/#/r/quinces-marmalade/quoted')
      await page.reload()
      await page.locator('.quote').first().waitFor()
      const stops = await tabStops(page)
      expect(stops.length).toBeGreaterThanOrEqual(3)
      expect(inVisualOrder(stops)).toEqual([])
    })

    test('Cook Mode at a held note, from the top of the page', async ({ page }) => {
      await page.goto(DEEP_LINK)
      await page.reload()
      await expect(cookRoot(page)).toHaveAttribute('data-note-state', 'held', { timeout: 40_000 })
      const stops = await tabStops(page)
      console.log(`${name} cook:`, stops.map((s) => s.name).join(' | '))
      expect(stops.length).toBeGreaterThanOrEqual(6)
      expect(inVisualOrder(stops)).toEqual([])
    })

    test('Cook Mode: the Wipe control takes focus when ready, Tab goes on to Mute, and Shift+Tab walks back up the page in visual order', async ({ page }) => {
      await page.goto(DEEP_LINK)
      await page.reload()
      await expect(cookRoot(page)).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
      await expect(page.locator('button.wipe')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: /^(Mute|Unmute)/ })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(page.locator('button.wipe')).toBeFocused()
      const up: Stop[] = []
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Shift+Tab')
        const s = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement
          if (el === document.body) return null
          const r = el.getBoundingClientRect()
          let fixed = false
          for (let n: HTMLElement | null = el; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') fixed = true
          const shift = fixed ? document.documentElement.scrollHeight - window.innerHeight : window.scrollY
          return { name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), top: r.top + shift, bottom: r.bottom + shift, left: r.left }
        })
        if (!s) break
        up.push(s)
      }
      expect(up.map((s) => s.name)).toEqual(['Back', 'Pace of the pot', 'Step text', 'Start again', 'Public Domain Mark'].filter((n) => up.some((u) => u.name.startsWith(n))))
      expect(inVisualOrder([...up].reverse())).toEqual([])
    })
  })
}
