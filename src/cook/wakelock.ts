// Screen wake lock (R17). Best effort: nothing depends on the lock and nothing waits for it.
// A refusal is tried again when the page becomes visible and on the next gesture. A lock the browser or the OS takes away
// while the page is visible is asked for once more, and a refusal of that stops it (a2a-arch-r05 B7).

export interface SentinelLike {
  release(): Promise<void>
  addEventListener?(type: 'release', cb: () => void): void
}
export interface WakeLockNav {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> }
}
export type WakeStatus = 'idle' | 'held' | 'refused' | 'unsupported'

export interface WakeLockOpts {
  /** Whether the page is visible now. Without it a release from the browser is not answered by a new request. */
  visible?: () => boolean
  /** Called whenever `status` changes, including when it changes after a promise settles. */
  onChange?: () => void
}

export function createWakeLock(nav: WakeLockNav | undefined, opts: WakeLockOpts = {}) {
  let status: WakeStatus = nav?.wakeLock ? 'idle' : 'unsupported'
  let sentinel: SentinelLike | null = null
  /** Bumped by `release()`: a request that started in an earlier generation was asked for a Cook Mode that has closed. */
  let gen = 0
  /** The generation of the request in flight, or -1. */
  let pending = -1
  /** A release from the browser has been answered with one request already; the next waits for a hide/show or a gesture. */
  let answered = false
  const set = (s: WakeStatus): void => {
    if (s === status) return
    status = s
    opts.onChange?.()
  }
  const api = {
    get status(): WakeStatus {
      return status
    },
    /** Requests the lock unless it is held, being requested or was refused since the page was last visible. */
    async acquire(): Promise<void> {
      if (!nav?.wakeLock || status === 'held' || status === 'refused' || pending === gen) return
      const mine = gen
      pending = mine
      try {
        const s = await nav.wakeLock.request('screen')
        if (mine !== gen) {
          // Cook Mode closed while the request was out: give the lock straight back
          void s.release().catch(() => {})
          return
        }
        sentinel = s
        set('held')
        s.addEventListener?.('release', () => {
          if (sentinel !== s) return // our own release(), or an older lock
          sentinel = null
          set('idle')
          if (!answered && opts.visible?.()) {
            answered = true
            void api.acquire()
          }
        })
      } catch {
        if (mine === gen) set('refused')
      } finally {
        if (pending === mine) pending = -1
      }
    },
    /** The page became visible again: a refusal may be tried once more. */
    async onVisible(): Promise<void> {
      answered = false
      if (status === 'refused') set('idle')
      await api.acquire()
    },
    /** A pointerdown or keydown inside Cook Mode: a refusal is tried once more. A held lock is left alone. */
    async onGesture(): Promise<void> {
      if (status !== 'refused') return
      answered = false
      set('idle')
      await api.acquire()
    },
    /** Idempotent. */
    release(): void {
      const s = sentinel
      sentinel = null
      gen++
      if (nav?.wakeLock && status !== 'refused') set('idle')
      if (s) void s.release().catch(() => {})
    },
  }
  return api
}
export type WakeLock = ReturnType<typeof createWakeLock>
