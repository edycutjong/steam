// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SchedEffect, SchedEvent } from '../cook/scheduler.ts'
import { toSnapshot } from '../cook/scheduler.ts'
import { openStore, type Store } from '../data/store.ts'
import { flush, loaded, mount, tick, unmountAll } from './render.fixture.tsx'
import { parseRoute } from './router.ts'
import { useCookSession, type CookRoute, type Session } from './useCookSession.ts'

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0)
beforeEach(() => vi.useFakeTimers({ now: T0 }))
afterEach(() => { unmountAll(); vi.useRealTimers() })

const r = loaded()
const route = (h: string) => parseRoute(h) as CookRoute
function harness(hash: string, store: Promise<Store> = openStore(null)) {
  const out: { s: Session | null; effects: { e: SchedEffect[]; ev: SchedEvent }[] } = { s: null, effects: [] }
  function H() {
    out.s = useCookSession({ recipe: r, route: route(hash), store, onEffects: (e, c) => out.effects.push({ e, ev: c.event }) })
    return null
  }
  mount(<H />)
  return out
}
const reveals = (o: ReturnType<typeof harness>) => o.effects.flatMap((x) => x.e).filter((e) => e.type === 'reveal')

describe('useCookSession (R12.7, R18.2, R18.4, R18.5, R19.1, R19.3, R19.5, R26.4)', () => {
  it('a plain start dispatches start: step 1, the step-entry note revealed at once', async () => {
    const o = harness('#/r/quinces-marmalade/cook')
    await flush()
    expect(o.s!.started).toBe('start')
    expect(o.s!.state.stepIndex).toBe(0)
    expect(o.effects[0]!.ev.type).toBe('start')
    expect(reveals(o).map((e) => e.noteId)).toEqual(['full-ripe'])
  })
  it('a note= route dispatches deepLink at its step with leadMs 10 000 by default, or lead x 1000', async () => {
    const o = harness('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12')
    await flush()
    expect(o.s!.started).toBe('deepLink')
    expect(o.s!.state.stepIndex).toBe(4)
    expect(o.s!.state.holdUntilWall).toBe(T0 + 10_000)
    await tick(9_999)
    expect(reveals(o)).toEqual([])
    await tick(260)
    expect(reveals(o).map((e) => e.noteId)).toEqual(['till-it-looks-red-smooth'])
    unmountAll()
    const p = harness('#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&lead=3')
    await flush()
    expect(p.s!.state.holdUntilWall! - p.s!.startWall!).toBe(3_000)
  })
  it('a valid saved session and no note restores; an invalid or stale one starts fresh', async () => {
    const store = openStore(null)
    const s = await store
    await s.putSession({ v: 1, recipeId: 'quinces-marmalade', stepIndex: 3, stepStartWall: T0 - 60_000, paceHistory: [{ atWall: T0 - 60_000, pace: 4 }], revealed: ['full-ripe', 'when-tender'] } as never)
    const o = harness('#/r/quinces-marmalade/cook', store)
    await flush()
    expect(o.s!.started).toBe('restore')
    expect(o.s!.state.stepIndex).toBe(3)
    expect(reveals(o)).toEqual([])
    unmountAll()
    await s.putSession({ v: 1, recipeId: 'quinces-marmalade', stepIndex: 3, stepStartWall: T0 - 13 * 3600_000, paceHistory: [{ atWall: T0 - 13 * 3600_000, pace: 1 }], revealed: [] } as never)
    const stale = harness('#/r/quinces-marmalade/cook', store)
    await flush()
    expect(stale.s!.started).toBe('start')
    expect(stale.s!.state.stepIndex).toBe(0)
  })
  it('an unknown note starts at step 1 with the unknownNote caption', async () => {
    const o = harness('#/r/quinces-marmalade/cook?note=not-a-note')
    await flush()
    expect(o.s!.started).toBe('unknownNote')
    expect(o.s!.state.stepIndex).toBe(0)
  })
  it('the one timer wakes at most every 250 ms, and a tick at the due wall time yields the reveal', async () => {
    const store = openStore(null)
    await (await store).putTiming('quinces-marmalade', 'full-ripe', 60)
    const o = harness('#/r/quinces-marmalade/cook', store)
    await flush()
    expect(reveals(o)).toEqual([])
    expect(vi.getTimerCount()).toBe(1)
    await tick(59_900)
    expect(reveals(o)).toEqual([])
    await tick(400)
    expect(reveals(o).length).toBe(1)
    expect(reveals(o)[0]!.wallMs - T0).toBeLessThanOrEqual(60_250)
  })
  it('hidden sends sleep and visible sends resume; after a 3-hour freeze exactly one reveal comes', async () => {
    const store = openStore(null)
    await (await store).putTiming('quinces-marmalade', 'full-ripe', 600)
    const o = harness('#/r/quinces-marmalade/cook', store)
    await flush()
    const vis = (v: DocumentVisibilityState) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); act(() => void document.dispatchEvent(new Event('visibilitychange'))) }
    vis('hidden')
    expect(o.s!.state.asleep).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(T0 + 3 * 3600_000) // the page is frozen: no timer runs, the wall clock moves on
    vis('visible')
    await flush()
    expect(o.s!.state.asleep).toBe(false)
    expect(reveals(o).length).toBe(1)
    await tick(5_000)
    expect(reveals(o).length).toBe(1)
  })
  it('every change of state writes the snapshot', async () => {
    const store = openStore(null)
    const o = harness('#/r/quinces-marmalade/cook', store)
    await flush()
    o.s!.dispatch({ type: 'setPace', pace: 4 })
    await flush()
    const saved = await (await store).getSession('quinces-marmalade')
    expect(saved).toEqual(toSnapshot(o.s!.state, 'quinces-marmalade'))
  })
  it('unmount removes every timer and listener', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const rem = vi.spyOn(document, 'removeEventListener')
    const wadd = vi.spyOn(window, 'addEventListener')
    const wrem = vi.spyOn(window, 'removeEventListener')
    harness('#/r/quinces-marmalade/cook')
    await flush()
    await tick(1000)
    unmountAll()
    const count = (s: typeof add, t: string) => s.mock.calls.filter((c) => c[0] === t).length
    for (const t of ['visibilitychange']) expect(count(add, t)).toBe(count(rem, t))
    for (const t of ['pageshow', 'focus', 'pagehide']) expect(count(wadd, t)).toBe(count(wrem, t))
    expect(vi.getTimerCount()).toBe(0)
  })
})
