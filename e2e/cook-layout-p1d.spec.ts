// cook-layout-p1d: Cook Mode layout, measured as bounding boxes (no screenshot diffs). See .kiro/specs/cook-layout-p1d/bugfix.md.
import { expect, test, type Page } from '@playwright/test'
import { cookRoot, RECIPE, waitWipe, wipe } from './helpers/cook.ts'

interface Box {
  x: number
  y: number
  width: number
  height: number
}
const link = (note: string, extra = ''): string => `/#/r/${RECIPE}/cook?note=${note}&pace=12${extra}`
const hit = (a: Box, b: Box): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const rd = (b: Box): string => `[${[b.x, b.y, b.width, b.height].map(Math.round).join(', ')}]`

async function open(page: Page, url: string, state: 'writing' | 'held'): Promise<void> {
  await page.goto(url)
  await page.reload() // a hash change alone does not reload
  await page.waitForFunction((s) => document.querySelector('main.cook')?.getAttribute('data-note-state') === s, state, { timeout: 40_000 })
  await page.waitForTimeout(state === 'held' ? 900 : 0)
}
const box = async (page: Page, sel: string): Promise<Box> => {
  const b = await page.locator(sel).first().boundingBox()
  if (!b) throw new Error(`no box for ${sel}`)
  return b
}
const boxes = async (page: Page, sel: string): Promise<Box[]> => {
  const out: Box[] = []
  for (const l of await page.locator(sel).all()) {
    const b = await l.boundingBox()
    if (b) out.push(b)
  }
  return out
}

/** The element at the centre of the box is the element itself or inside it: nothing covers it. */
const uncovered = (page: Page, sel: string): Promise<boolean[]> =>
  page.locator(sel).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return t !== null && (e === t || e.contains(t))
    }),
  )

// ---- 1. phone: the bar clips nothing, at every step including the hold --------------------------------------------------
for (const [w, h] of [
  [390, 844],
  [393, 852],
] as const) {
  test.describe(`1. phone ${w} x ${h}: timer, dial and pace are whole, uncovered and tappable`, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

    async function check(page: Page, where: string): Promise<void> {
      await page.evaluate(() => window.scrollTo(0, 0))
      const bar = await box(page, '.controls')
      expect(bar.y + bar.height, `${where}: the bar ends inside the viewport`).toBeLessThanOrEqual(h + 0.5)
      for (const sel of ['.timer', '.timer__pace', '.knob__dial', '.knob__stop', '.badge', '.step__text']) {
        for (const b of await boxes(page, sel)) {
          expect(b.x, `${where}: ${sel} left ${rd(b)}`).toBeGreaterThanOrEqual(0)
          expect(b.x + b.width, `${where}: ${sel} right ${rd(b)}`).toBeLessThanOrEqual(w)
          expect(b.y, `${where}: ${sel} top ${rd(b)}`).toBeGreaterThanOrEqual(0)
          expect(b.y + b.height, `${where}: ${sel} bottom ${rd(b)} against the bar at ${Math.round(bar.y)}`).toBeLessThanOrEqual(bar.y)
        }
      }
      for (const sel of ['.timer', '.knob__dial', '.knob__stop', '.controls .btn', 'button.wipe']) {
        for (const u of await uncovered(page, sel)) expect(u, `${where}: ${sel} is not covered by anything`).toBe(true)
      }
      for (const sel of ['.knob__dial', '.knob__stop', '.controls .btn', 'button.wipe']) {
        for (const b of await boxes(page, sel)) {
          expect(b.width, `${where}: ${sel} width`).toBeGreaterThanOrEqual(44)
          expect(b.height, `${where}: ${sel} height`).toBeGreaterThanOrEqual(44)
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    for (const [note, step] of [
      ['full-ripe', 1],
      ['when-tender', 4],
      ['till-it-looks-red-smooth', 5],
    ] as const) {
      test(`the hold of step ${step} (${note}) at scroll 0`, async ({ page }) => {
        await open(page, link(note), 'held')
        await check(page, `hold, step ${step}`)
      })
    }

    test('the steps without a note (2 and 3) and the writing state', async ({ page }) => {
      await open(page, link('full-ripe'), 'writing')
      await check(page, 'writing, step 1')
      await waitWipe(page, 'Wipe the glass')
      await wipe(page).click()
      for (const step of [2, 3]) {
        await expect(cookRoot(page)).toHaveAttribute('data-step', String(step))
        await waitWipe(page, 'Next step')
        await page.waitForTimeout(700)
        await check(page, `step ${step}`)
        await wipe(page).click()
      }
    })

    test('the bar keeps the home-indicator inset in its own padding and the page keeps room under the last line', async ({ page }) => {
      await open(page, link('till-it-looks-red-smooth'), 'held')
      const css = await page.evaluate(() => {
        const out: string[] = []
        for (const sh of Array.from(document.styleSheets)) for (const r of Array.from(sh.cssRules)) out.push(r.cssText)
        return out.join('\n')
      })
      expect(css).toMatch(/\.controls\s*\{[^}]*padding:[^;}]*safe-area-inset-bottom/)
      expect(css).toMatch(/\.cook\s*\{[^}]*padding-bottom:[^;}]*safe-area-inset-bottom/)
    })
  })
}

// ---- 2. phone: "The hand is writing…" never reaches Unmute ---------------------------------------------------------------
for (const [w, h] of [
  [320, 640],
  [360, 740],
  [390, 844],
  [393, 852],
] as const) {
  test.describe(`2. ${w} px wide: the writing label stays inside its button`, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    test('no overlap with Back or Unmute, no clipped text, while writing and when held', async ({ page }) => {
      await page.goto(link('till-it-looks-red-smooth'))
      await page.reload()
      await page.waitForFunction(() => /writing/i.test(document.querySelector('button.wipe')?.textContent ?? ''), null, { timeout: 40_000 })
      for (const phase of ['writing', 'held'] as const) {
        if (phase === 'held') await page.waitForFunction(() => document.querySelector('main.cook')?.getAttribute('data-note-state') === 'held', null, { timeout: 40_000 })
        const m = await page.evaluate(() => {
          const btn = document.querySelector('button.wipe') as HTMLElement
          const r = document.createRange()
          r.selectNodeContents(btn)
          const t = r.getBoundingClientRect()
          const b = btn.getBoundingClientRect()
          return {
            label: btn.textContent,
            text: { x: t.x, y: t.y, width: t.width, height: t.height },
            btn: { x: b.x, y: b.y, width: b.width, height: b.height },
            over: [btn.scrollWidth - btn.clientWidth, btn.scrollHeight - btn.clientHeight],
          }
        })
        const wb = await box(page, 'button.wipe')
        const back = await box(page, '.controls a.btn')
        const mute = await box(page, '.controls .mute')
        expect(hit(wb, back), `${phase} "${m.label}": wipe ${rd(wb)} against Back ${rd(back)}`).toBe(false)
        expect(hit(wb, mute), `${phase} "${m.label}": wipe ${rd(wb)} against Unmute ${rd(mute)}`).toBe(false)
        expect(m.text.x, `${phase}: text starts inside the button`).toBeGreaterThanOrEqual(m.btn.x - 0.5)
        expect(m.text.x + m.text.width, `${phase}: text ends inside the button`).toBeLessThanOrEqual(m.btn.x + m.btn.width + 0.5)
        expect(m.text.y, `${phase}: text top`).toBeGreaterThanOrEqual(m.btn.y - 0.5)
        expect(m.text.y + m.text.height, `${phase}: text bottom`).toBeLessThanOrEqual(m.btn.y + m.btn.height + 0.5)
        expect(m.over[0], `${phase}: no horizontal overflow`).toBeLessThanOrEqual(0)
        expect(m.over[1], `${phase}: no vertical overflow`).toBeLessThanOrEqual(0)
        expect(wb.height).toBeGreaterThanOrEqual(48)
        for (const b of [back, mute]) expect(b.x + b.width).toBeLessThanOrEqual(w)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
    })
  })
}

// ---- 3. one attribution line per view -------------------------------------------------------------------------------------
test.describe('3. one attribution line', () => {
  for (const [name, vp, mobile] of [
    ['desktop', { width: 1280, height: 720 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as const) {
    test(`${name}: the mono slip alone names the source; no serif credit line`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile })
      const page = await ctx.newPage()
      await open(page, link('till-it-looks-red-smooth'), 'held')
      await expect(page.locator('main.cook .credit-line')).toHaveCount(0)
      await expect(page.locator('main.cook .slip')).toHaveCount(1)
      const slip = (await page.locator('main.cook .slip').innerText()).replace(/\s+/g, ' ')
      for (const f of ['Wellcome Collection', 'MS.1810', 'p.23', 'c. 1750', 'Public Domain Mark']) expect(slip.toLowerCase(), f).toContain(f.toLowerCase())
      const main = (await page.locator('main.cook').innerText()).toLowerCase()
      expect(main.split('wellcome collection').length - 1, 'the institution is named once in the view').toBe(1)
      expect(main.split('public domain mark').length - 1, 'the licence is named once in the view').toBe(1)
      await ctx.close()
    })
  }
})

// ---- 4. desktop 1280 x 720: the reading slot is reserved, nothing is clipped ---------------------------------------------
test.describe('4. desktop 1280 x 720', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  async function inside(page: Page, where: string): Promise<void> {
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight, window.innerHeight]), `${where}: no scroll needed`).toEqual([0, 720, 720])
    for (const sel of ['.controls .btn', 'button.wipe', '.timer', '.knob__dial', '.knob__stop', '.step__text', '.cook__caption .btn', '.slip']) {
      for (const b of await boxes(page, sel)) {
        expect(b.x, `${where}: ${sel} ${rd(b)}`).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width, `${where}: ${sel} ${rd(b)}`).toBeLessThanOrEqual(1280)
        expect(b.y, `${where}: ${sel} ${rd(b)}`).toBeGreaterThanOrEqual(0)
        expect(b.y + b.height, `${where}: ${sel} ${rd(b)} bottom edge`).toBeLessThanOrEqual(720)
      }
    }
    for (const u of await uncovered(page, '.controls .btn, button.wipe')) expect(u).toBe(true)
  }

  for (const note of ['till-it-looks-red-smooth', 'full-ripe', 'when-tender']) {
    test(`${note}: Back, "The hand, quoted" and Unmute do not move when the reading appears, and all stay inside the viewport`, async ({ page }) => {
      await open(page, link(note), 'writing')
      expect(await page.locator('[data-note-reading]').count(), 'before the hold the reading is absent').toBe(0)
      const before = { back: await box(page, '.controls a.btn'), wipe: await box(page, 'button.wipe'), mute: await box(page, '.controls .mute'), step: await box(page, '.step__text'), under: await box(page, '.cook__under') }
      await inside(page, 'writing')
      await page.waitForFunction(() => document.querySelector('main.cook')?.getAttribute('data-note-state') === 'held', null, { timeout: 40_000 })
      await page.waitForTimeout(900)
      await expect(page.locator('[data-note-reading]')).toHaveCount(1)
      const after = { back: await box(page, '.controls a.btn'), wipe: await box(page, 'button.wipe'), mute: await box(page, '.controls .mute'), step: await box(page, '.step__text'), under: await box(page, '.cook__under') }
      for (const k of Object.keys(before) as (keyof typeof before)[]) {
        expect(Math.abs(after[k].y - before[k].y), `${k} moved from ${rd(before[k])} to ${rd(after[k])}`).toBeLessThanOrEqual(0.5)
        expect(Math.abs(after[k].x - before[k].x), `${k} x`).toBeLessThanOrEqual(0.5)
        expect(Math.abs(after[k].height - before[k].height), `${k} height`).toBeLessThanOrEqual(0.5)
      }
      await inside(page, 'hold')
    })
  }

  test('wiping to the next step and back to a held note never clips the bottom controls', async ({ page }) => {
    await open(page, link('full-ripe'), 'held')
    await waitWipe(page, 'Wipe the glass')
    await wipe(page).click()
    for (const step of [2, 3]) {
      await expect(cookRoot(page)).toHaveAttribute('data-step', String(step))
      await waitWipe(page, 'Next step')
      await page.waitForTimeout(700)
      await inside(page, `step ${step}`)
      await wipe(page).click()
    }
    await expect(cookRoot(page)).toHaveAttribute('data-step', '4')
    await page.waitForFunction(() => document.querySelector('main.cook')?.getAttribute('data-note-state') === 'held', null, { timeout: 40_000 })
    await page.waitForTimeout(900)
    await inside(page, 'step 4 hold')
  })
})

// ---- 5. the timer's colour follows its state, nothing else -----------------------------------------------------------------
test.describe('5. timer colour', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('the colour is a function of data-timer-state; it changes only when the state changes', async ({ page }) => {
    test.setTimeout(90_000)
    // lead=14: the note is due 14 s of wall time after the start, so the timer is running, then in its last 10 s, then the note arrives
    await page.goto(link('till-it-looks-red-smooth', '&lead=14'))
    await page.reload()
    await page.locator('.timer').waitFor()
    const samples: { t: number; state: string | null; color: string }[] = []
    const t0 = Date.now()
    while (Date.now() - t0 < 26_000) {
      samples.push(await page.locator('.timer').evaluate((e) => ({ t: performance.now(), state: e.getAttribute('data-timer-state'), color: getComputedStyle(e).color })))
      await page.waitForTimeout(120)
    }
    const states = [...new Set(samples.map((s) => s.state))]
    expect(states.every((s) => s !== null), `every sample has a state, saw ${states.join(', ')}`).toBe(true)
    expect(states.every((s) => ['running', 'ember', 'paused', 'done'].includes(s!)), states.join(', ')).toBe(true)
    // colour per state, once the 400 ms transition has settled (600 ms after the state began)
    const settled = new Map<string, Set<string>>()
    let since = samples[0]!.t
    for (let i = 0; i < samples.length; i++) {
      if (i > 0 && samples[i]!.state !== samples[i - 1]!.state) since = samples[i]!.t
      if (samples[i]!.t - since >= 600) (settled.get(samples[i]!.state!) ?? settled.set(samples[i]!.state!, new Set()).get(samples[i]!.state!)!).add(samples[i]!.color)
    }
    for (const [s, c] of settled) expect([...c], `state ${s} has one colour`).toHaveLength(1)
    expect([...(settled.get('running') ?? [])], 'running is --muted').toEqual(['rgb(154, 143, 130)'])
    if (settled.has('ember')) expect([...settled.get('ember')!], 'ember is --after').toEqual(['rgb(242, 166, 90)'])
    expect(states, 'the run passes through ember before the note').toContain('ember')
  })
})

// ---- 6. reduced motion: the control says what is true ----------------------------------------------------------------------
test.describe('6. reduced motion', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('the primary button never says "writing" and reads "Show the note" while the note appears', async ({ page }) => {
    test.setTimeout(60_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(link('till-it-looks-red-smooth', '&lead=1'))
    await page.reload()
    const seen = new Set<string>()
    const t0 = Date.now()
    while (Date.now() - t0 < 12_000) {
      const s = await page.evaluate(() => ({ label: document.querySelector('button.wipe')?.textContent ?? '', state: document.querySelector('main.cook')?.getAttribute('data-note-state') ?? '', desc: document.querySelector('button.wipe')?.getAttribute('aria-describedby') }))
      seen.add(`${s.state}|${s.label}`)
      expect(s.label.toLowerCase(), 'no "writing" label under reduced motion').not.toContain('writing')
      if (s.state === 'held') break
      await page.waitForTimeout(40)
    }
    await expect(cookRoot(page)).toHaveAttribute('data-note-state', 'held')
    await expect(cookRoot(page)).toHaveAttribute('data-reduced-motion', 'true')
    await expect(wipe(page)).toHaveText('The hand, quoted')
    const during = [...seen].filter((s) => s.startsWith('writing|'))
    for (const d of during) expect(d, 'while the note appears').toBe('writing|Show the note')
    // the hidden description does not claim a pen either
    expect(await page.locator('main.cook .sr-only').allInnerTexts()).not.toContain('The note is being written')
  })
})

// Interaction QA (P1d): the attribution line arriving at the reveal moves nothing below it (it was +33 px on a phone, and the
// caption jumped sideways on desktop). Same boxes before the slip is shown and after the note is held.
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
  test(`attribution slot is reserved: no control moves when the slip arrives (${vp.width}x${vp.height})`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(vp)
    await page.goto(link('till-it-looks-red-smooth'))
    await page.reload()
    await page.waitForSelector('button.wipe')
    await expect(page.locator('.cook__source')).toHaveAttribute('data-slip', 'reserved')
    const sel = ['.timer', '.knob', 'button.wipe', '.cook__caption', '.step']
    const before: Box[] = []
    for (const s of sel) before.push(await box(page, s))
    await page.waitForFunction(() => document.querySelector('main.cook')?.getAttribute('data-note-state') === 'held', undefined, { timeout: 40_000 })
    await expect(page.locator('.cook__source')).toHaveAttribute('data-slip', 'shown')
    await page.waitForTimeout(900)
    for (let i = 0; i < sel.length; i++) {
      const a = await box(page, sel[i]!)
      expect(Math.abs(a.x - before[i]!.x), `${sel[i]} x ${rd(before[i]!)} -> ${rd(a)}`).toBeLessThanOrEqual(0.5)
      expect(Math.abs(a.y - before[i]!.y), `${sel[i]} y ${rd(before[i]!)} -> ${rd(a)}`).toBeLessThanOrEqual(0.5)
    }
  })
}
