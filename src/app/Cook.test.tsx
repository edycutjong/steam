// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUOTED } from '../copy/strings.ts'
import { regionUrl } from '../data/provenance.ts'
import { openStore, type Store } from '../data/store.ts'
import { WIPE_MS, WRITE_ON_MS } from '../steam/timeline.ts'
import { testApp } from './app.fixture.tsx'
import Cook from './Cook.tsx'
import { FakeGlass, panes, setAutoReady } from './glass.fixture.tsx'
import { click, flush, loaded, mount, stubBrowser, text, tick, unmountAll } from './render.fixture.tsx'
import { parseRoute } from './router.ts'

const T0 = Date.UTC(2026, 10, 25, 9)
beforeEach(() => { vi.useFakeTimers({ now: T0 }); stubBrowser(); vi.stubGlobal('fetch', () => new Promise(() => {})); panes.clear(); setAutoReady(true) })
afterEach(() => { unmountAll(); vi.useRealTimers(); vi.unstubAllGlobals(); location.hash = '' })

const r = loaded()
async function open(hash: string, store: Promise<Store> = openStore(null)) {
  location.hash = hash
  const app = testApp({ recipes: [r], store })
  const host = mount(app.wrap(<Cook recipe={r} route={parseRoute(hash) as never} Glass={FakeGlass} wakeNav={{}} />))
  await flush()
  await tick(50)
  const root = host.querySelector('main.cook') as HTMLElement
  return { host, root, app, store }
}
const wipeBtn = (h: HTMLElement) => h.querySelector('button.wipe') as HTMLButtonElement
const press = async (h: HTMLElement) => { click(wipeBtn(h)); await tick(450) }

describe('Cook screen (R9, R14.7, R14.8, R18.5, R18.6, R19.1, R19.2, R19.8, R15.7)', () => {
  it('lays out stage, caption, step, text, timer, knob, then the controls Wipe, Back, Mute in DOM order', async () => {
    const { root } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth')
    const order = ['.stage', '.cook__caption', '.step__of', '.step__text', '.timer', '[role="slider"]', '.controls'].map((s) => root.querySelector(s)!)
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Back, Wipe, Mute: the Wipe control sits at the centre of the row (R14.3), so DOM order equals visual order
    const controls = [...root.querySelectorAll('.controls > a, .controls > button')].map((e) => text(e).split(':')[0])
    expect(controls).toEqual(['Back', 'Show the note', 'Unmute'])
  })
  it('the archive slip shows under the pane only while the current note is revealed, and never on a step without a note', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    expect(root.dataset.noteState).toBe('writing')
    expect(host.querySelector('.cook__under .slip')).not.toBeNull()
    // one attribution line (cook-layout-p1d L3): the mono slip names the source, no serif credit line repeats it
    expect(host.querySelector('.cook__under .credit-line')).toBeNull()
    expect(text(host.querySelector('.cook__under .slip'))).toContain('Wellcome Collection')
    expect(text(host.querySelector('.cook__under .slip'))).toContain('c. 1750')
    expect(text(host.querySelector('.cook__under .slip'))).toContain('Public Domain Mark')
    expect(text(host.querySelector('.cook__under')).split('Wellcome Collection').length - 1).toBe(1)
    await tick(WRITE_ON_MS + 100)
    expect(root.dataset.noteState).toBe('held')
    await press(host)
    expect(root.dataset.step).toBe('2')
    expect(root.dataset.noteState).toBe('none')
    expect(host.querySelector('.cook__under .slip')).toBeNull()
  })
  // a2a-arch-r05 B10: every reveal carries a "verify at source" link to the same pixels on the archive's server (product.md, Provenance).
  it('while a note is revealed the compact slip carries a verify-at-source link for that note, writing and held, and none without a note (a2a-arch-r05 B10)', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    const link = () => host.querySelector('.cook__under .slip a.slip__verify') as HTMLAnchorElement | null
    const note = (id: string) => r.notes.find((n) => n.id === id)!
    expect(root.dataset.noteState).toBe('writing')
    expect(link()).not.toBeNull()
    expect(link()!.getAttribute('href')).toBe(regionUrl(r.bundle, note('full-ripe')))
    expect(link()!.getAttribute('href')).toMatch(/\/full\/0\/default\.jpg$/)
    expect(link()!.getAttribute('target')).toBe('_blank')
    expect(link()!.getAttribute('rel')).toBe('noopener noreferrer')
    expect(text(link())).toBe(QUOTED.verify)
    expect(link()!.getAttribute('aria-label')).toBe(QUOTED.verifyName)
    expect(host.querySelectorAll('.cook__under .slip a')).toHaveLength(2) // the licence link and this one
    await tick(WRITE_ON_MS + 100)
    expect(root.dataset.noteState).toBe('held')
    expect(link()!.getAttribute('href')).toBe(regionUrl(r.bundle, note('full-ripe')))
    await press(host)
    expect(root.dataset.step).toBe('2')
    expect(host.querySelector('.cook__under .slip')).toBeNull() // no note on step 2: no slip, no link
  })
  it('the link follows the note of the step: step 4 links its own region (a2a-arch-r05 B10)', async () => {
    const { host } = await open('#/r/quinces-marmalade/cook?note=when-tender&lead=0')
    const link = host.querySelector('.cook__under .slip a.slip__verify') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(regionUrl(r.bundle, r.notes.find((n) => n.id === 'when-tender')!))
    expect(link.getAttribute('href')).not.toBe(regionUrl(r.bundle, r.notes.find((n) => n.id === 'full-ripe')!))
  })
  it('shows the reviewed reading under the pane only while the note holds, in the accessibility tree (look pass 3, R20.3, R20.4; a2a-arch-r05 B9)', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    expect(root.dataset.noteState).toBe('writing')
    expect(host.querySelector('[data-note-reading]')).toBeNull()
    await tick(WRITE_ON_MS + 100)
    expect(root.dataset.noteState).toBe('held')
    const reading = host.querySelector('.cook > [data-note-reading]') as HTMLElement
    expect(reading).not.toBeNull()
    // a2a-arch-r05 B9 changed this assertion on purpose: it was `aria-hidden` = 'true', on the claim that the live region had announced the
    // words; the next message (a pace change) replaces them there, so the held note must be readable in the tree itself.
    expect(reading.hasAttribute('aria-hidden')).toBe(false)
    expect(reading.closest('[aria-hidden="true"]')).toBeNull()
    expect(text(reading)).toBe('full ripe,')
    expect(host.querySelector('.stage')!.contains(reading)).toBe(false) // under the pane, never on the glass
    await press(host)
    expect(host.querySelector('[data-note-reading]')).toBeNull()
  })
  it('the held reading stays readable after a later message replaces the note in the live region, and adds no announcement of its own (a2a-arch-r05 B9)', async () => {
    const { host, root, app } = await open('#/r/quinces-marmalade/cook')
    await tick(WRITE_ON_MS - 500)
    const before = app.said.length
    await tick(700)
    expect(root.dataset.noteState).toBe('held')
    expect(app.said.length).toBe(before) // the reading's arrival says nothing
    // any later message, here a pace change, replaces the live region's text
    const knob = host.querySelector('[role="slider"]') as HTMLElement
    const said = app.said.length
    act(() => void knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    const reading = host.querySelector('[data-note-reading]') as HTMLElement
    expect(app.said.length).toBeGreaterThan(said)
    expect(app.said.at(-1)).not.toContain('full ripe')
    expect(reading.closest('[aria-hidden="true"]')).toBeNull()
    expect(text(reading)).toBe('full ripe,')
  })
  it('the canvas pane and the empty reading slot stay hidden from assistive tech (a2a-arch-r05 B9)', async () => {
    const { host } = await open('#/r/quinces-marmalade/cook')
    expect((host.querySelector('.cook > .cook__reading') as HTMLElement).getAttribute('aria-hidden')).toBe('true') // the empty placeholder
    expect(host.querySelector('.stage section.pane')!.getAttribute('aria-hidden')).toBe('true')
  })
  it('keeps a one-line reading slot in the layout before the hold, so the reading arriving moves nothing (cook-layout-p1d L4)', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    expect(root.dataset.noteState).toBe('writing')
    const slot = host.querySelector('.cook > .cook__reading') as HTMLElement
    expect(slot).not.toBeNull()
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.hasAttribute('data-note-reading')).toBe(false)
    await tick(WRITE_ON_MS + 100)
    expect(host.querySelectorAll('.cook > .cook__reading')).toHaveLength(1)
    expect(host.querySelector('.cook > .cook__reading')!.hasAttribute('data-note-reading')).toBe(true)
  })
  it('Back links to the edition view and keeps the snapshot', async () => {
    const { host, store } = await open('#/r/quinces-marmalade/cook')
    expect(host.querySelector('.controls a')!.getAttribute('href')).toBe('#/r/quinces-marmalade')
    expect(await (await store).getSession('quinces-marmalade')).not.toBeNull()
  })
  it('captions "Started at step 5 of 5" and "Resumed at step n of N", each with "Start again"', async () => {
    const a = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth')
    expect(text(a.host.querySelector('.cook__caption span'))).toBe('Started at step 5 of 5')
    expect(text(a.host.querySelector('.cook__caption button'))).toBe('Start again')
    unmountAll()
    const store = openStore(null)
    await (await store).putSession({ v: 1, recipeId: 'quinces-marmalade', stepIndex: 2, stepStartWall: T0 - 1000, paceHistory: [{ atWall: T0 - 1000, pace: 1 }], revealed: ['full-ripe'] } as never)
    const b = await open('#/r/quinces-marmalade/cook', store)
    expect(text(b.host.querySelector('.cook__caption span'))).toBe('Resumed at step 3 of 5')
    expect(b.app.said.join(' | ')).toContain('Resumed at step 3 of 5. Step 3 of 5. Pareings')
    click([...b.host.querySelectorAll('button')].find((x) => x.textContent === 'Start again')!)
    await flush()
    await tick(50)
    expect(await (await store).getSession('quinces-marmalade')).toMatchObject({ stepIndex: 0 })
  })
  it('the live region gets one composed message per batch', async () => {
    const { host, app } = await open('#/r/quinces-marmalade/cook')
    expect(app.said.at(-1)).toBe("Step 1 of 5. Let your quinces be full ripe, then wipe The writer's note, handwritten: full ripe")
    await tick(WRITE_ON_MS + 100)
    await press(host)
    expect(app.said.at(-1)).toBe('Glass wiped. Step 2 of 5. them, & pare them, & Quarter them, then (N.26) (the second reader reads nothing) take out the Cores (the second reader reads cores) and seeds, & boil the')
  })
  it('the root carries the test attributes and cook:ready is marked once', async () => {
    const mark = vi.spyOn(performance, 'mark')
    const { root } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12')
    expect(root.dataset).toMatchObject({ step: '5', stepCount: '5', noteState: 'pending', pace: '12', ready: 'true', startedAtStep: '5' })
    expect(root.getAttribute('data-revealed') ?? '').toBe('')
    expect(root.dataset.wake).toBe('unsupported')
    expect(mark.mock.calls.filter((c) => c[0] === 'cook:ready').length).toBe(1)
  })
  it('a full walk passes every row of the Wipe table and ends at "The hand, quoted", deleting the snapshot', async () => {
    const { host, root, store } = await open('#/r/quinces-marmalade/cook')
    const seen: string[] = []
    const step = async () => {
      // a revealed note writes first; the control waits for the hold
      while (root.dataset.noteState === 'writing') await tick(500)
      seen.push(`${root.dataset.step}:${wipeBtn(host).textContent}`)
      await press(host)
      await tick(WIPE_MS + 700)
    }
    for (let i = 0; i < 5; i++) await step()
    expect(seen).toEqual(['1:Wipe the glass', '2:Next step', '3:Next step', '4:Wipe the glass', '5:The hand, quoted'])
    expect(location.hash).toBe('#/r/quinces-marmalade/quoted')
    expect(await (await store).getSession('quinces-marmalade')).toBeNull()
  })
  it('"Show the note" on a pending note starts the write-on; a double activation advances one step', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook?note=when-tender')
    expect(wipeBtn(host).textContent).toBe('Show the note')
    await press(host)
    expect(panes.get('when-tender')!.started).toBe(1)
    await tick(WRITE_ON_MS + 100)
    click(wipeBtn(host))
    click(wipeBtn(host))
    await tick(450)
    expect(root.dataset.step).toBe('5')
  })
  it('a note revealed by the scheduler but not yet on the glass keeps the control disabled, so it cannot be wiped unseen (R14.7)', async () => {
    setAutoReady(false)
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    expect(root.dataset.revealed).toBe('full-ripe')
    expect(root.dataset.noteState).toBe('pending')
    expect(wipeBtn(host).getAttribute('aria-disabled')).toBe('true')
    click(wipeBtn(host))
    await tick(450)
    expect(root.dataset.step).toBe('1')
    panes.get('full-ripe')!.ready()
    await tick(WRITE_ON_MS + 100)
    expect(wipeBtn(host).getAttribute('aria-disabled')).toBeNull()
  })
  it('a note whose scan failed counts as shown: the cook can go on', async () => {
    setAutoReady(false)
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    panes.get('full-ripe')!.fail()
    await tick(10)
    expect(text(host)).toContain('The scan of this note could not be loaded.')
    await press(host)
    expect(root.dataset.step).toBe('2')
  })
  // cook-mode-qa-r1 Q1
  it('at ×12 the clock on the screen says it is paced, in its text and in its accessible name; at real time it does not', async () => {
    const a = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12')
    await tick(5000)
    const t = a.host.querySelector('.timer')!
    expect(text(t)).toMatch(/^\d+:\d\d cooking time at ×12$/)
    expect(t.getAttribute('aria-label')).toMatch(/^\d+:\d\d, cooking time at ×12$/)
    unmountAll()
    const b = await open('#/r/quinces-marmalade/cook')
    expect(text(b.host.querySelector('.timer'))).toMatch(/^\d+:\d\d$/)
    expect(b.host.querySelector('.timer')!.hasAttribute('aria-label')).toBe(false)
  })
  // cook-mode-qa-r1 Q2: every row of the Wipe table, with the writing state of each revealed row
  it('the button says "The hand is writing…" (aria-disabled) while a revealed note is written, then its table label; every row', async () => {
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    const rows: string[] = []
    for (let i = 0; i < 5; i++) {
      if (root.dataset.noteState === 'writing') {
        rows.push(`${root.dataset.step}:${wipeBtn(host).textContent}:${wipeBtn(host).getAttribute('aria-disabled')}`)
        click(wipeBtn(host)) // pressing it while writing does nothing
        await tick(450)
        expect(root.dataset.step).toBe(String(i + 1))
        await tick(WRITE_ON_MS + 100)
      }
      rows.push(`${root.dataset.step}:${wipeBtn(host).textContent}:${wipeBtn(host).getAttribute('aria-disabled')}`)
      await press(host)
      await tick(WIPE_MS + 700)
    }
    expect(rows).toEqual([
      '1:The hand is writing…:true',
      '1:Wipe the glass:null',
      '2:Next step:null',
      '3:Next step:null',
      '4:The hand is writing…:true',
      '4:Wipe the glass:null',
      '5:The hand is writing…:true',
      '5:The hand, quoted:null',
    ])
  })
  it('a pending note shows "Show the note", enabled; a revealed note whose pane is not ready says the hand is writing', async () => {
    const a = await open('#/r/quinces-marmalade/cook?note=when-tender')
    expect(wipeBtn(a.host).textContent).toBe('Show the note')
    expect(wipeBtn(a.host).hasAttribute('aria-disabled')).toBe(false)
    unmountAll()
    setAutoReady(false)
    const b = await open('#/r/quinces-marmalade/cook')
    expect(wipeBtn(b.host).textContent).toBe('The hand is writing…')
    expect(wipeBtn(b.host).getAttribute('aria-disabled')).toBe('true')
  })
  // cook-mode-qa-r1 Q3
  it('the "readers disagree" description exists only on a step that has a † mark, hidden, and only the † spans point at it', async () => {
    const PHRASE = 'Two independent readers disagree'
    const free = (host: HTMLElement) => [...host.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').includes(PHRASE) && !e.closest('[hidden]'))
    const { host, root } = await open('#/r/quinces-marmalade/cook')
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      while (root.dataset.noteState === 'writing') await tick(500)
      const marks = [...host.querySelectorAll('.step .mark')]
      const desc = host.querySelector('#disagree-desc')
      seen.push(`${root.dataset.step}:${marks.length > 0}:${desc !== null}`)
      expect(free(host)).toEqual([])
      if (marks.length > 0) {
        expect(desc!.hasAttribute('hidden')).toBe(true)
        for (const m of marks) expect(m.getAttribute('aria-describedby')).toBe('disagree-desc')
      }
      expect([...host.querySelectorAll('[aria-describedby="disagree-desc"]')].every((e) => e.classList.contains('mark'))).toBe(true)
      await press(host)
      await tick(WIPE_MS + 700)
    }
    expect(seen).toEqual(['1:false:false', '2:true:true', '3:false:false', '4:true:true', '5:true:true'])
  })
})

// a2a-arch-r06 C6: the sweep stands still while the tab is hidden (a2a-arch-r05 B1), so the hand-over to "The hand, quoted" waits for it.
describe('the hand-over after the last wipe waits for visible time (a2a-arch-r06 C6)', () => {
  const setVis = (v: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
  }
  afterEach(() => setVis('visible'))
  const QUOTED_HASH = '#/r/quinces-marmalade/quoted'
  /** Deep link to the last step, shown and held; returns after the click on the last wipe. */
  async function lastWipe() {
    const o = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth')
    click(wipeBtn(o.host)) // Show the note
    await tick(WRITE_ON_MS + 200)
    expect(o.root.dataset.noteState).toBe('held')
    expect(wipeBtn(o.host).textContent).toBe('The hand, quoted')
    click(wipeBtn(o.host))
    return o
  }

  it('visible behaviour is unchanged: not before 1400 ms, there by 1500 ms', async () => {
    await lastWipe()
    await tick(1300)
    expect(location.hash).not.toBe(QUOTED_HASH)
    await tick(200)
    expect(location.hash).toBe(QUOTED_HASH)
  })
  it('hiding the phone within the sweep keeps the sweep: the hand-over waits for the rest of its visible time', async () => {
    await lastWipe()
    await tick(300)
    setVis('hidden')
    await tick(30_000)
    expect(location.hash).not.toBe(QUOTED_HASH)
    setVis('visible')
    await tick(900)
    expect(location.hash).not.toBe(QUOTED_HASH) // 300 + 900 ms of visible time
    await tick(300)
    expect(location.hash).toBe(QUOTED_HASH)
  })
  it('a pageshow with no visibilitychange resumes the countdown when the page is visible', async () => {
    await lastWipe()
    await tick(300)
    setVis('hidden')
    await tick(5000)
    expect(location.hash).not.toBe(QUOTED_HASH)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => void window.dispatchEvent(new Event('pageshow')))
    await tick(900)
    expect(location.hash).not.toBe(QUOTED_HASH) // 300 + 900 ms of visible time
    await tick(300)
    expect(location.hash).toBe(QUOTED_HASH)
  })
  it('closing Cook Mode during the sweep cancels the hand-over', async () => {
    await lastWipe()
    await tick(300)
    const before = location.hash
    unmountAll()
    await tick(5000)
    expect(location.hash).toBe(before)
  })
})
