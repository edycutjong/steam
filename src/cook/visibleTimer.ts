// A countdown that only runs while the page is visible (a2a-arch-r06 C6).
// The glass's sweep stands still while the tab is hidden (a2a-arch-r05 B1); whatever waits for the sweep has to wait the same way.

/** What the countdown needs from the page; tests pass their own. */
export interface VisibleTimerEnv {
  visible(): boolean
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** Calls `cb` on every event that may mean the page was hidden or came back. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void
}

export interface VisibleTimer {
  cancel(): void
}

/** The page: `document.visibilityState`, and `visibilitychange`, `pageshow` and `focus` (a restored page may send only the last two; a2a-arch-r05 B8). */
const pageEnv: VisibleTimerEnv = {
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  now: () => performance.now(),
  // read at call time, so a test that fakes the global timers is obeyed
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  subscribe(cb) {
    document.addEventListener('visibilitychange', cb)
    window.addEventListener('pageshow', cb)
    window.addEventListener('focus', cb)
    return () => {
      document.removeEventListener('visibilitychange', cb)
      window.removeEventListener('pageshow', cb)
      window.removeEventListener('focus', cb)
    }
  },
}

/**
 * Calls `fn` once, after `ms` of time in which the page was visible. The countdown pauses while the page is hidden and goes on when it is
 * visible again (on `visibilitychange`, `pageshow` or `focus`). `cancel()` is idempotent and lets go of everything.
 */
export function createVisibleTimer(ms: number, fn: () => void, env: Partial<VisibleTimerEnv> = {}): VisibleTimer {
  const e: VisibleTimerEnv = { ...pageEnv, ...env }
  let remaining = ms
  let handle: unknown = null
  let startedAt = 0
  let done = false
  let unsubscribe: (() => void) | null = null

  const stop = (): void => {
    done = true
    if (handle !== null) e.clearTimeout(handle)
    handle = null
    unsubscribe?.()
    unsubscribe = null
  }
  const fire = (): void => {
    handle = null
    // a hide whose event never reached us: the time ran out while hidden, so it is spent and `fn` waits for the page
    if (!e.visible()) {
      remaining = 0
      return
    }
    stop()
    fn()
  }
  const sync = (): void => {
    if (done) return
    if (e.visible()) {
      if (handle !== null) return
      if (remaining <= 0) return fire()
      startedAt = e.now()
      handle = e.setTimeout(fire, remaining)
    } else if (handle !== null) {
      remaining = Math.max(0, remaining - (e.now() - startedAt))
      e.clearTimeout(handle)
      handle = null
    }
  }
  unsubscribe = e.subscribe(sync)
  sync()
  return { cancel: stop }
}
