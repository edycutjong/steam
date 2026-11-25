// a2a-arch-r06 C6: the hand-over to "The hand, quoted" waits for the sweep's worth of visible time.
import { describe, expect, it, vi } from 'vitest'
import { fakeTimers } from '../data/timers.fixture.ts'
import { createVisibleTimer, type VisibleTimerEnv } from './visibleTimer.ts'

function setup(startVisible = true) {
  const timers = fakeTimers()
  let clock = 0
  let visible = startVisible
  const subs = new Set<() => void>()
  const env: VisibleTimerEnv = {
    visible: () => visible,
    now: () => clock,
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeout: (h) => timers.clearTimeout(h),
    subscribe: (cb) => (subs.add(cb), () => void subs.delete(cb)),
  }
  const emit = () => [...subs].forEach((f) => f())
  return {
    env,
    timers,
    subs,
    /** Time passes, on the page's clock and on the timers. */
    pass(ms: number) {
      clock += ms
      timers.advance(ms)
    },
    /** A visibilitychange. */
    show() {
      visible = true
      emit()
    },
    hide() {
      visible = false
      emit()
    },
    /** The page is visible again and the only event is a pageshow or a focus (or none yet). */
    showSilently() {
      visible = true
    },
    /** The page went hidden and no event reached us. */
    hideSilently() {
      visible = false
    },
    emit,
  }
}

describe('createVisibleTimer (a2a-arch-r06 C6)', () => {
  it('fires once, after the full time, while the page stays visible', () => {
    const s = setup()
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    s.pass(1399)
    expect(fn).not.toHaveBeenCalled()
    s.pass(1)
    expect(fn).toHaveBeenCalledTimes(1)
    s.pass(10_000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('stands still while hidden and fires after the rest of the visible time once shown', () => {
    const s = setup()
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    s.pass(400)
    s.hide()
    s.pass(10 * 60_000)
    expect(fn).not.toHaveBeenCalled()
    s.show()
    s.pass(999)
    expect(fn).not.toHaveBeenCalled()
    s.pass(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('adds up the visible time over several hides', () => {
    const s = setup()
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    for (let i = 0; i < 6; i++) {
      s.pass(200)
      s.hide()
      s.pass(30_000)
      s.show()
    }
    expect(fn).not.toHaveBeenCalled() // 6 x 200 ms = 1200 ms of visible time so far
    s.pass(199)
    expect(fn).not.toHaveBeenCalled()
    s.pass(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('a page that starts hidden does not count until it is shown', () => {
    const s = setup(false)
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    s.pass(60_000)
    expect(fn).not.toHaveBeenCalled()
    s.show()
    s.pass(1399)
    expect(fn).not.toHaveBeenCalled()
    s.pass(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('a pageshow or a focus with no visibilitychange resumes it when the page is visible, and does nothing while hidden', () => {
    const s = setup()
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    s.pass(400)
    s.hide()
    s.emit() // a focus event while still hidden
    s.pass(5000)
    expect(fn).not.toHaveBeenCalled()
    s.showSilently()
    s.emit() // pageshow, no visibilitychange
    s.pass(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('cancel stops it for good and lets go of the page events', () => {
    const s = setup()
    const fn = vi.fn()
    const t = createVisibleTimer(1400, fn, s.env)
    s.pass(500)
    t.cancel()
    t.cancel()
    expect(s.timers.pending).toBe(0)
    expect(s.subs.size).toBe(0)
    s.pass(10_000)
    s.hide()
    s.show()
    s.pass(10_000)
    expect(fn).not.toHaveBeenCalled()
  })
  it('leaves nothing behind once it has fired', () => {
    const s = setup()
    createVisibleTimer(1400, () => {}, s.env)
    s.pass(1400)
    expect(s.timers.pending).toBe(0)
    expect(s.subs.size).toBe(0)
  })
  it('a timer that fires while the page is hidden (the hide was never seen) waits for the page to be visible', () => {
    const s = setup()
    const fn = vi.fn()
    createVisibleTimer(1400, fn, s.env)
    s.pass(100)
    s.hideSilently()
    s.pass(2000)
    expect(fn).not.toHaveBeenCalled()
    s.showSilently()
    s.emit()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
