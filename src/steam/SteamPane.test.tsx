// @vitest-environment happy-dom
// a2a-arch-r05 B11: note text comes from fetched JSON; only a string is used.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SteamGlassProps } from './SteamGlass.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const glass = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('./SteamGlass.tsx', () => ({
  LOAD_FAILED: 'The note could not be loaded.',
  default: (p: unknown) => {
    glass.props = p
    return null
  },
}))

import SteamPane, { announcement } from './SteamPane.tsx'

let root: Root | null = null
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function open(json: unknown): Promise<HTMLElement> {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(json), { status: 200 }))
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(SteamPane, { stem: '/x/note-a', paneDir: '/x/panes', noteId: 'a', query: '' }))
    await vi.advanceTimersByTimeAsync(10)
  })
  return host
}
const phase = async (p: string) => {
  await act(async () => {
    ;(glass.props as SteamGlassProps).onState!({ phase: p, u: 0.5, thicken: 1, head: 1, wipe: 0, refog: 0 } as never)
    await vi.advanceTimersByTimeAsync(10)
  })
}
const live = (h: HTMLElement) => (h.querySelector('[role="status"]')!.textContent ?? '').trim()

describe('SteamPane note text from fetched JSON (a2a-arch-r05 B11)', () => {
  it('uses a string span for the live region', async () => {
    const h = await open({ span: 'till it Looks red', shownText: 'till it Looks red & smooth,' })
    await phase('writing')
    expect(live(h)).toBe(announcement('till it Looks red'))
  })
  it.each([[5], [{ a: 1 }], [['x']], [true]])('a non-string span (%j) gives an empty note text, not its string form', async (span) => {
    const h = await open({ span, shownText: 'abc' })
    await phase('writing')
    expect(live(h)).toBe('')
  })
  it('a missing span falls back to shownText when that is a string, and to nothing when it is not', async () => {
    const a = await open({ shownText: 'abc' })
    await phase('writing')
    expect(live(a)).toBe(announcement('abc'))
    act(() => root?.unmount())
    const b = await open({ shownText: 7 })
    await phase('writing')
    expect(live(b)).toBe('')
  })
  it('a non-string shownText shows no reading under the pane', async () => {
    const h = await open({ span: 'x', shownText: { text: 'y' } })
    await phase('holding')
    expect(h.querySelector('[data-note-reading]')).toBeNull()
  })
  it('a string shownText shows the reading at the hold', async () => {
    const h = await open({ span: 'x', shownText: 'till it Looks red & smooth,' })
    await phase('holding')
    expect(h.querySelector('[data-note-reading]')!.textContent).toBe('till it Looks red & smooth,')
  })
})

// a2a-arch-r06 C2: the note JSON that never answers is aborted after 10 s; the pane keeps its empty text and nothing throws.
describe('SteamPane note JSON deadline (a2a-arch-r06 C2)', () => {
  async function openHanging(): Promise<{ host: HTMLElement; signals: AbortSignal[] }> {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', (_u: string, init?: RequestInit) => (init?.signal && signals.push(init.signal), new Promise<Response>(() => {})))
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(createElement(SteamPane, { stem: '/x/note-a', paneDir: '/x/panes', noteId: 'a', query: '' }))
      await vi.advanceTimersByTimeAsync(10)
    })
    return { host, signals }
  }
  it('aborts the request at 10 s, not before, and the live region stays empty', async () => {
    const { host, signals } = await openHanging()
    expect(signals).toHaveLength(1)
    await act(async () => void (await vi.advanceTimersByTimeAsync(9_980)))
    expect(signals[0]!.aborted).toBe(false)
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)))
    expect(signals[0]!.aborted).toBe(true)
    await phase('writing')
    expect(live(host)).toBe('')
  })
  it('unmounting before the deadline leaves no timer running', async () => {
    await openHanging()
    act(() => root!.unmount())
    root = null
    expect(vi.getTimerCount()).toBe(0)
  })
  it('an answer inside the deadline is used as before and clears the timer', async () => {
    const h = await open({ span: 'till it Looks red', shownText: 'x' })
    await phase('writing')
    expect(live(h)).toBe(announcement('till it Looks red'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
