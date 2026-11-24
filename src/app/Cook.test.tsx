// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(text(host.querySelector('.cook__under'))).toContain('Wellcome Collection, Public Domain Mark')
    await tick(WRITE_ON_MS + 100)
    expect(root.dataset.noteState).toBe('held')
    await press(host)
    expect(root.dataset.step).toBe('2')
    expect(root.dataset.noteState).toBe('none')
    expect(host.querySelector('.cook__under .slip')).toBeNull()
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
})
