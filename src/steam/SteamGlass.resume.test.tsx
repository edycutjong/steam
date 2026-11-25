// @vitest-environment happy-dom
// a2a-arch-r05 B4: whatever sends the glass to the static pane, a live reveal state that exists is carried on, not restarted.
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Loaded, RevealController } from './SteamGlass.tsx'
import type { RevealState } from './timeline.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const live = vi.hoisted(() => ({ onState: null as ((s: unknown) => void) | null, onDegrade: null as (() => void) | null, onLost: null as (() => void) | null, created: 0, disposed: 0 }))

vi.mock('./renderer.ts', () => ({
  SteamRenderer: {
    create: () => {
      live.created++
      return {
        resize() {}, setCandle() {}, setClock() {}, play() {}, resetStats() {}, startReveal() {}, wipe() {},
        dispose() { live.disposed++ },
        onState(cb: (s: unknown) => void) { live.onState = cb },
        onDegrade(cb: () => void) { live.onDegrade = cb },
        onContextLost(cb: () => void) { live.onLost = cb },
        revealMs: Number.NEGATIVE_INFINITY, headFracX: 0, tier: 0,
      }
    },
  },
}))
vi.mock('./gaps.ts', () => ({ buildSplits: () => [] }))
vi.mock('./layout.ts', () => ({ chooseLayout: () => 'page', computeLayout: () => ({ kind: 'page', fits: true, groups: [] }) }))

import SteamGlass from './SteamGlass.tsx'

const st = (over: Partial<RevealState>): RevealState => ({ phase: 'fogged', u: -1, thicken: 0, head: 0, wipe: 0, refog: 0, ...over })
const WRITING = st({ phase: 'writing', u: 0.5, thicken: 1, head: 1 })
const HOLDING = st({ phase: 'holding', u: 1, thicken: 1 })

let root: Root | null = null
let reduced = false
const mqListeners = new Set<() => void>()
beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  mqListeners.clear()
  live.onState = live.onDegrade = live.onLost = null
  live.created = live.disposed = 0
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return /reduce/.test(q) && reduced },
    media: q,
    addEventListener: (_t: string, cb: () => void) => void mqListeners.add(cb),
    removeEventListener: (_t: string, cb: () => void) => void mqListeners.delete(cb),
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const prepared = { assets: { meta: { size: [1, 1], groups: [] }, toi: { data: new Uint8Array(4) }, note: {}, noteData: {} }, derived: { ink: new Uint8Array(1) } } as unknown as Loaded
function mount() {
  const states: RevealState[] = []
  const ref = createRef<RevealController | null>() as { current: RevealController | null }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(createElement(SteamGlass, { stem: '/x/note-a', paneDir: '/x/panes', noteId: 'a', params: { t: null, lead: Infinity, fps: false }, controllerRef: ref, onState: (s: RevealState) => states.push(s), prepared }))
  })
  return { states, ref, host }
}
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('SteamGlass hands the live state to the static pane (a2a-arch-r05 B4)', () => {
  it('reduced motion switched on while the note is held: the static pane shows it held, not fogged', async () => {
    const m = mount()
    await settle(50)
    expect(live.created).toBe(1)
    act(() => live.onState!(HOLDING))
    m.states.length = 0
    reduced = true
    act(() => void [...mqListeners].forEach((f) => f()))
    await settle(150)
    expect(m.host.querySelector('.static-pane')).not.toBeNull()
    expect(m.states.length).toBeGreaterThan(0)
    expect(m.states.every((s) => s.phase === 'holding')).toBe(true)
  })

  it('tier 3 while the note is written: the static pane carries on writing', async () => {
    const m = mount()
    await settle(50)
    act(() => live.onState!(WRITING))
    m.states.length = 0
    act(() => live.onDegrade!())
    await settle(150)
    expect(m.host.querySelector('.static-pane')).not.toBeNull()
    expect(m.states[0]!.phase).toBe('writing')
    expect(m.states[0]!.u).toBeGreaterThanOrEqual(0.5)
  })

  it('a lost context still resumes from the live state (cook-mode-qa-r1 Q8)', async () => {
    const m = mount()
    await settle(50)
    act(() => live.onState!(HOLDING))
    m.states.length = 0
    act(() => live.onLost!())
    await settle(150)
    expect(m.states.every((s) => s.phase === 'holding')).toBe(true)
  })

  it('a reduced-motion page that never had a live state stays fogged and waits for startReveal', async () => {
    reduced = true
    const m = mount()
    await settle(3000)
    expect(live.created).toBe(0)
    expect(m.states.every((s) => s.phase === 'fogged')).toBe(true)
    act(() => m.ref.current!.startReveal())
    await settle(150)
    expect(m.states.at(-1)!.phase).not.toBe('fogged')
  })
})
