// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WakeLockNav } from '../cook/wakelock.ts'
import { openStore, type Store } from '../data/store.ts'
import { testApp } from './app.fixture.tsx'
import Cook from './Cook.tsx'
import { FakeGlass, panes } from './glass.fixture.tsx'
import { flush, loaded, mount, stubBrowser, text, tick, unmountAll } from './render.fixture.tsx'
import { parseRoute } from './router.ts'

beforeEach(() => { vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 9) }); stubBrowser(); vi.stubGlobal('fetch', () => new Promise(() => {})); panes.clear() })
afterEach(() => { unmountAll(); vi.useRealTimers(); vi.unstubAllGlobals() })

const r = loaded()
async function open(nav: WakeLockNav, store: Promise<Store> = openStore(new IDBFactory())) {
  const hash = '#/r/quinces-marmalade/cook'
  const host = mount(testApp({ recipes: [r], store }).wrap(<Cook recipe={r} route={parseRoute(hash) as never} Glass={FakeGlass} wakeNav={nav} />))
  await flush()
  await tick(50)
  return { host, root: host.querySelector('main.cook') as HTMLElement }
}
const vis = (v: DocumentVisibilityState) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); act(() => void document.dispatchEvent(new Event('visibilitychange'))) }

describe('wake lock and persistence notices (R17, R18.8)', () => {
  it('a granted lock gives data-wake="held"; leaving the screen releases it', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    const { root } = await open({ wakeLock: { request } })
    expect(request).toHaveBeenCalledWith('screen')
    expect(root.dataset.wake).toBe('held')
    unmountAll()
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('a refusal gives "refused" and the screen is unchanged; visibility returning asks again', async () => {
    const request = vi.fn(async () => { throw new Error('NotAllowedError') })
    const { host, root } = await open({ wakeLock: { request } })
    expect(root.dataset.wake).toBe('refused')
    expect(text(host)).not.toMatch(/awake|wake lock/i)
    vis('hidden')
    vis('visible')
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })
  // a2a-arch-r05 B7
  it('a refusal is asked again on the next pointerdown or keydown inside Cook Mode, and the listeners go when Cook closes', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn().mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue({ release })
    const { root } = await open({ wakeLock: { request } })
    expect(root.dataset.wake).toBe('refused')
    act(() => void document.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(root.dataset.wake).toBe('held')
    act(() => void document.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    unmountAll()
    act(() => void document.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('a keydown retries a refusal too, but a held key (repeat) does not hammer it', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const { root } = await open({ wakeLock: { request } })
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, repeat: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(root.dataset.wake).toBe('refused')
  })
  it('a release from the browser while the page is visible asks once more, and data-wake follows', async () => {
    const added: (() => void)[] = []
    const s1 = { release: vi.fn(async () => {}), addEventListener: (_t: string, cb: () => void) => void added.push(cb) }
    const s2 = { release: vi.fn(async () => {}), addEventListener: () => {} }
    const request = vi.fn().mockResolvedValueOnce(s1).mockResolvedValueOnce(s2)
    const { root } = await open({ wakeLock: { request } })
    expect(root.dataset.wake).toBe('held')
    act(() => added[0]!())
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(root.dataset.wake).toBe('held')
  })
  // a2a-arch-r06 C4
  it('after the browser has released the lock twice, the next pointerdown in Cook Mode asks again and data-wake is held', async () => {
    const added: (() => void)[] = []
    const mk = () => ({ release: vi.fn(async () => {}), addEventListener: (_t: string, cb: () => void) => void added.push(cb) })
    const request = vi.fn().mockResolvedValueOnce(mk()).mockResolvedValueOnce(mk()).mockResolvedValueOnce(mk())
    const { root } = await open({ wakeLock: { request } })
    act(() => added[0]!())
    await flush()
    act(() => added[1]!())
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(root.dataset.wake).toBe('idle')
    act(() => void document.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await flush()
    expect(request).toHaveBeenCalledTimes(3)
    expect(root.dataset.wake).toBe('held')
  })
  it('a lock that arrives after Cook has closed is released at once', async () => {
    let resolve!: (s: { release(): Promise<void> }) => void
    const request = vi.fn(() => new Promise<{ release(): Promise<void> }>((r) => { resolve = r }))
    await open({ wakeLock: { request } })
    unmountAll()
    const release = vi.fn(async () => {})
    resolve({ release })
    await flush()
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('no API gives "unsupported" and no text', async () => {
    const { host, root } = await open({})
    expect(root.dataset.wake).toBe('unsupported')
    expect(text(host)).not.toMatch(/awake|wake lock/i)
  })
  it('with a store that is not persistent the muted line "This browser will not keep your place." shows once', async () => {
    const { host } = await open({}, openStore(null))
    expect((text(host).match(/This browser will not keep your place\./g) ?? []).length).toBe(1)
  })
  it('with a persistent store the line is absent', async () => {
    const { host } = await open({})
    expect(text(host)).not.toContain('will not keep your place')
  })
})
