// Screen wake lock (R17). Best effort: a refusal is not retried until the page becomes visible again, and nothing depends on the lock.

export interface SentinelLike {
  release(): Promise<void>
  addEventListener?(type: 'release', cb: () => void): void
}
export interface WakeLockNav {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> }
}
export type WakeStatus = 'idle' | 'held' | 'refused' | 'unsupported'

export function createWakeLock(nav: WakeLockNav | undefined) {
  let status: WakeStatus = nav?.wakeLock ? 'idle' : 'unsupported'
  let sentinel: SentinelLike | null = null
  let pending = false
  const api = {
    get status(): WakeStatus {
      return status
    },
    /** Requests the lock unless it is held, being requested or was refused since the page was last visible. */
    async acquire(): Promise<void> {
      if (!nav?.wakeLock || status === 'held' || status === 'refused' || pending) return
      pending = true
      try {
        const s = await nav.wakeLock.request('screen')
        sentinel = s
        status = 'held'
        s.addEventListener?.('release', () => {
          if (sentinel === s) {
            sentinel = null
            status = 'idle'
          }
        })
      } catch {
        status = 'refused'
      } finally {
        pending = false
      }
    },
    /** The page became visible again: a refusal may be tried once more. */
    async onVisible(): Promise<void> {
      if (status === 'refused') status = 'idle'
      await api.acquire()
    },
    /** Idempotent. */
    release(): void {
      const s = sentinel
      sentinel = null
      if (nav?.wakeLock && status !== 'refused') status = 'idle'
      if (s) void s.release().catch(() => {})
    },
  }
  return api
}
export type WakeLock = ReturnType<typeof createWakeLock>
