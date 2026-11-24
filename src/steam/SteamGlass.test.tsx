// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SteamGlass, { type Loaded, type RevealController } from './SteamGlass.tsx'
import type { RevealState } from './timeline.ts'
import { WRITE_ON_MS } from './timeline.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The static path needs no GPU: reduced motion selects it. Its clock is the one the renderer's timeline uses.
let root: Root | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const prepared = {} as unknown as Loaded // the static path never reads the assets
function mount(p: { params: { t: number | null; lead: number; fps: boolean }; initial?: 'fogged' | 'held' }) {
  const states: RevealState[] = []
  let ready = 0
  const ref = createRef<RevealController | null>() as { current: RevealController | null }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(createElement(SteamGlass, { stem: '/x/note-a', paneDir: '/x/panes', noteId: 'a', params: p.params, initial: p.initial, controllerRef: ref, onState: (s: RevealState) => states.push(s), onReady: () => void ready++, prepared }))
  })
  return { states, ref, ready: () => ready, host }
}
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('SteamGlass (R15.1, R15.2, R15.4, R23.1)', () => {
  it('reads nothing from window.location', async () => {
    const spy = vi.spyOn(window, 'location', 'get').mockImplementation(() => { throw new Error('SteamGlass read window.location') })
    const m = mount({ params: { t: null, lead: Infinity, fps: false } })
    await settle(500)
    expect(m.states.length).toBeGreaterThan(0)
    spy.mockRestore()
  })
  it('with lead Infinity the pane is fogged after 3 s, never starts by itself, and startReveal() moves it to writing', async () => {
    const m = mount({ params: { t: null, lead: Infinity, fps: false } })
    await settle(3000)
    expect(m.states.at(-1)!.phase).toBe('fogged')
    await settle(60_000)
    expect(m.states.every((s) => s.phase === 'fogged')).toBe(true)
    expect(m.ref.current).not.toBeNull()
    act(() => m.ref.current!.startReveal())
    await settle(150)
    expect(m.states.at(-1)!.phase).toBe('writing')
  })
  it('with initial "held" (lead -WRITE_ON_MS) the first state is holding', async () => {
    const m = mount({ params: { t: null, lead: Infinity, fps: false }, initial: 'held' })
    await settle(10)
    expect(m.states[0]!.phase).toBe('holding')
    expect(WRITE_ON_MS).toBe(5000)
    act(() => m.ref.current!.wipe())
    await settle(150)
    expect(m.states.at(-1)!.phase).toBe('wiped')
  })
  it('onReady fires once', async () => {
    const m = mount({ params: { t: null, lead: Infinity, fps: false } })
    await settle(2000)
    expect(m.ready()).toBe(1)
  })
  it('the static pane stacks its three images for the note, by opacity only', async () => {
    const m = mount({ params: { t: null, lead: Infinity, fps: false } })
    await settle(10)
    const imgs = [...m.host.querySelectorAll('.static-pane img')] as HTMLImageElement[]
    expect(imgs.length).toBe(3)
    expect(imgs[0]!.getAttribute('src')).toMatch(/^\/x\/panes\/a-(page|groups)-fogged\.webp$/)
  })
})
