// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { createAudio, type AudioCtx } from '../cook/audio.ts'
import { createShelfLoader } from '../data/catalog.ts'
import { openStore } from '../data/store.ts'
import { testApp } from './app.fixture.tsx'
import Cook from './Cook.tsx'
import { FakeGlass, panes, setAutoReady, setWriteMs } from './glass.fixture.tsx'
import { bundleText, click, css, flush, loaded, mount, stubBrowser, text, tick, unmountAll } from './render.fixture.tsx'
import { parseRoute } from './router.ts'

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 9), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  stubBrowser()
  vi.stubGlobal('fetch', () => new Promise(() => {}))
  panes.clear()
  setAutoReady(true)
  setWriteMs(1000)
})
afterEach(() => { unmountAll(); vi.useRealTimers(); vi.unstubAllGlobals(); setWriteMs(5000); location.hash = '' })

const r = loaded()
function fakeCtx(): AudioCtx {
  const p = { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }
  return { currentTime: 0, sampleRate: 8000, destination: {}, resume: async () => {}, suspend: async () => {}, createBuffer: (_c, n) => { const d = new Float32Array(n); return { getChannelData: () => d } }, createBufferSource: () => ({ buffer: null, loop: false, connect() {}, start() {} }), createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect() {} }), createGain: () => ({ gain: p, connect() {} }) }
}
async function open(hash: string, audio: ReturnType<typeof createAudio> | null) {
  location.hash = hash
  const host = mount(testApp({ recipes: [r], audio }).wrap(<Cook recipe={r} route={parseRoute(hash) as never} Glass={FakeGlass} wakeNav={{}} />))
  await flush()
  await tick(50)
  return host
}
const lamp = (h: HTMLElement) => h.querySelector('.lamp') as HTMLElement
const memStore = { getSetting: async () => undefined, putSetting: async () => {} }

describe('the haunting cue (R16.1, R16.2, R16.4 to R16.7, R23.8)', () => {
  it('applying a reveal runs one lamp dip and one duck; a second reveal inside 3 s starts no second cue', async () => {
    const audio = createAudio({ createContext: fakeCtx, doc: document }, memStore)
    audio.unlock()
    const duck = vi.spyOn(audio, 'duck')
    const h = await open('#/r/quinces-marmalade/cook?note=when-tender&lead=0', audio)
    expect(lamp(h).dataset.dips).toBe('1')
    expect(duck).toHaveBeenCalledTimes(1)
    await tick(1100) // held after the 1 s write-on of the stand-in glass
    click(h.querySelector('button.wipe'))
    await tick(1500) // the outgoing sweep (WIPE_MS) holds the next reveal back to about 2.9 s after the first
    await tick(100)
    expect(panes.get('till-it-looks-red-smooth')!.started).toBe(1)
    expect(lamp(h).dataset.dips).toBe('1')
    expect(duck).toHaveBeenCalledTimes(1)
  })
  it('the lamp is a --bg layer with pointer-events none; the dip changes opacity only and returns to 0', async () => {
    const rule = /\.lamp\s*\{[^}]*\}/.exec(css('src/app/cook.css'))![0]
    expect(rule).toMatch(/background:\s*var\(--bg\)/)
    expect(rule).toMatch(/pointer-events:\s*none/)
    expect(rule).toMatch(/position:\s*fixed/)
    const h = await open('#/r/quinces-marmalade/cook', null)
    const seen = new Set<string>()
    for (let t = 0; t < 1000; t += 50) {
      await tick(50)
      seen.add(lamp(h).getAttribute('style') ?? '')
    }
    for (const s of seen) expect(s).toMatch(/^(opacity: [\d.e-]+;?)?$/)
    expect([...seen].some((s) => /opacity: 0\.[1-9]/.test(s))).toBe(true)
    expect(lamp(h).style.opacity).toBe('0')
  })
  it('under prefers-reduced-motion the same single dip runs, by opacity only', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }))
    const h = await open('#/r/quinces-marmalade/cook', null)
    expect(h.querySelector('main')!.dataset.reducedMotion).toBe('true')
    expect(lamp(h).dataset.dips).toBe('1')
    await tick(400)
    expect(lamp(h).getAttribute('style')).toMatch(/^opacity: [\d.]+;?$/)
  })
  it('with no AudioContext the dip still runs and Mute is disabled with "This browser has no sound"', async () => {
    const audio = createAudio({ createContext: () => null, doc: document }, memStore)
    audio.unlock()
    const h = await open('#/r/quinces-marmalade/cook', audio)
    expect(lamp(h).dataset.dips).toBe('1')
    const m = h.querySelector('button.mute') as HTMLButtonElement
    expect(m.disabled).toBe(true)
    expect(text(m)).toContain('This browser has no sound')
  })
  it('Mute reads "Unmute" before any gesture; pressing it unlocks and plays; then "Mute", aria-pressed follows; the choice is stored', async () => {
    const store = openStore(null)
    const s = await store
    const factory = vi.fn(fakeCtx)
    const audio = createAudio({ createContext: factory, doc: document }, s)
    const h = await open('#/r/quinces-marmalade/cook', audio)
    const m = () => h.querySelector('button.mute') as HTMLButtonElement
    expect(m().textContent).toBe('Unmute')
    expect(m().getAttribute('aria-pressed')).toBe('true')
    expect(factory).not.toHaveBeenCalled()
    click(m())
    expect(factory).toHaveBeenCalledTimes(1)
    expect(m().textContent).toBe('Mute')
    expect(m().getAttribute('aria-pressed')).toBe('false')
    click(m())
    await flush()
    expect(m().textContent).toBe('Unmute')
    expect(await s.getSetting('muted')).toBe(true)
    expect(/\.btn\s*\{[^}]*min-height:\s*48px/.test(css('src/app/app.css'))).toBe(true)
  })
  it('the first pointerdown anywhere unlocks the sound once; nothing before it', async () => {
    location.hash = '#/'
    const factory = vi.fn(fakeCtx)
    const loader = createShelfLoader((async () => new Response(bundleText)) as never, JSON.parse('[{"id":"quinces-marmalade","title":"t","gateSha256":"' + r.bundle.gateSha256 + '"}]'))
    const host = document.createElement('div')
    document.body.append(host)
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(host)
    await act(async () => { root.render(createElement(App, { loader: () => loader.load(), store: openStore(null), createContext: factory })); await vi.advanceTimersByTimeAsync(50) })
    await flush()
    expect(factory).not.toHaveBeenCalled()
    act(() => void window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    act(() => void window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(factory).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
