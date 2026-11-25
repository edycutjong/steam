// A countdown that only runs while the page is visible (a2a-arch-r06 C6).

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

export function createVisibleTimer(ms: number, fn: () => void, env?: Partial<VisibleTimerEnv>): VisibleTimer {
  const set = env?.setTimeout ?? ((f: () => void, m: number) => setTimeout(f, m))
  const clear = env?.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const t = set(fn, ms) // the wall clock: what Cook did before a2a-arch-r06 C6
  return { cancel: () => clear(t) }
}
