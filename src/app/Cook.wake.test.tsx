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
