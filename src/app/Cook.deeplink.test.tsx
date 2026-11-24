// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudio } from '../cook/audio.ts'
import { testApp } from './app.fixture.tsx'
import Cook from './Cook.tsx'
import { FakeGlass, panes, setAutoReady } from './glass.fixture.tsx'
import { click, flush, loaded, mount, stubBrowser, text, tick, unmountAll } from './render.fixture.tsx'
import { parseRoute } from './router.ts'

beforeEach(() => { vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 9) }); stubBrowser(); vi.stubGlobal('fetch', () => new Promise(() => {})); panes.clear(); setAutoReady(true) })
afterEach(() => { unmountAll(); vi.useRealTimers(); vi.unstubAllGlobals(); setAutoReady(true) })

const r = loaded()
const HERO = 'till-it-looks-red-smooth'
async function open(hash: string, audio: ReturnType<typeof createAudio> | null = null) {
  const mark = vi.spyOn(performance, 'mark')
  const host = mount(testApp({ recipes: [r], audio }).wrap(<Cook recipe={r} route={parseRoute(hash) as never} Glass={FakeGlass} wakeNav={{}} />))
  await flush()
  const reveals = () => mark.mock.calls.filter((c) => c[0] === `cook:reveal:${HERO}`).length
  return { host, root: host.querySelector('main.cook') as HTMLElement, reveals }
}

describe('the deep link on the screen (R19.1 to R19.8, R12.9)', () => {
  it('?note=till-it-looks-red-smooth&pace=12 starts at step 5 of 5 with the badge and the caption; with no input the reveal applies at 10 s', async () => {
    const { host, root, reveals } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12')
    await tick(10)
    expect(text(host.querySelector('.step__of'))).toBe('Step 5 of 5')
    expect(text(host.querySelector('.badge'))).toBe('×12 pace')
    expect(text(host.querySelector('.cook__caption span'))).toBe('Started at step 5 of 5')
    expect(root.dataset.startedAtStep).toBe('5')
    await tick(9_800)
    expect(reveals()).toBe(0)
    await tick(500)
    expect(reveals()).toBe(1)
    expect(panes.get(HERO)!.started).toBe(1)
  })
  it('"Show the note" during the hold reveals at once, and the scheduled reveal is then a no-op', async () => {
    const { host, reveals } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth')
    await tick(1_000)
    expect(host.querySelector('button.wipe')!.textContent).toBe('Show the note')
    click(host.querySelector('button.wipe'))
    expect(reveals()).toBe(1)
    await tick(12_000)
    expect(reveals()).toBe(1)
  })
  it('lead=3 reveals at 3 s', async () => {
    const { reveals } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&lead=3')
    await tick(2_700)
    expect(reveals()).toBe(0)
    await tick(600)
    expect(reveals()).toBe(1)
  })
  it('a pane that becomes ready at 12 s gets the reveal at 12 s, not before and not twice', async () => {
    setAutoReady(false)
    const { reveals } = await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth')
    await tick(11_900)
    expect(reveals()).toBe(0)
    panes.get(HERO)!.ready()
    await tick(10)
    expect(reveals()).toBe(1)
    await tick(5_000)
    expect(reveals()).toBe(1)
  })
  it('an unknown note starts at step 1 with "That note is not on this page. Started at step 1 of 5."', async () => {
    const { host } = await open('#/r/quinces-marmalade/cook?note=no-such-note')
    await tick(10)
    expect(text(host.querySelector('.step__of'))).toBe('Step 1 of 5')
    expect(text(host.querySelector('.cook__caption'))).toBe('That note is not on this page. Started at step 1 of 5.')
  })
  it('no audio context is created before a gesture', async () => {
    const factory = vi.fn(() => null)
    const audio = createAudio({ createContext: factory, doc: document }, { getSetting: async () => undefined, putSetting: async () => {} })
    await open('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth', audio)
    await tick(12_000)
    expect(factory).not.toHaveBeenCalled()
  })
})
