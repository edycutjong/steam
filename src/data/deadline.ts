// A deadline for a request (a2a-arch-r06 C2): a fetch that hangs is aborted, so the retry and the failure paths that wait on it can start.

/** The timer functions the helper uses; tests pass their own. */
export interface DeadlineTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** The recipe's request and body (the shelf retries it). */
export const RECIPE_DEADLINE_MS = 10_000
/** One asset of a note: its JSON, its note image or its time-of-ink image. */
export const NOTE_DEADLINE_MS = 15_000
/** The spike page's note JSON. */
export const PANE_JSON_DEADLINE_MS = 10_000

export class DeadlineError extends Error {
  readonly ms: number
  constructor(ms: number) {
    super(`no answer within ${ms / 1000} s`)
    this.name = 'DeadlineError'
    this.ms = ms
  }
}

export interface DeadlineOptions {
  /** The caller's own abort. It is passed on to `run` and re-thrown as an abort, never as a `DeadlineError`. */
  signal?: AbortSignal
  timers?: DeadlineTimers
}

const globalTimers: DeadlineTimers = {
  // read at call time, so a test that fakes the global timers is obeyed
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
}

const abortOf = (signal: AbortSignal): unknown => signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })

/**
 * Runs `run(signal)` and rejects with a `DeadlineError` if it has not settled after `ms`, aborting `signal` so the request is cancelled.
 * `run` should cover the body as well as the headers. A request that ignores the signal is still given up on. The caller's own `opts.signal`
 * is passed on, and its abort rejects with the abort, never with a `DeadlineError`. The timer is cleared as soon as anything settles.
 */
export function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, opts: DeadlineOptions = {}): Promise<T> {
  const { signal: outer, timers = globalTimers } = opts
  if (outer?.aborted) return Promise.reject(abortOf(outer))
  return new Promise<T>((resolve, reject) => {
    const ctl = new AbortController()
    let done = false
    const finish = (settle: () => void): void => {
      if (done) return
      done = true
      timers.clearTimeout(handle)
      outer?.removeEventListener('abort', onOuter)
      settle()
    }
    const onOuter = (): void =>
      finish(() => {
        ctl.abort(abortOf(outer!))
        reject(abortOf(outer!))
      })
    const handle = timers.setTimeout(
      () =>
        finish(() => {
          const e = new DeadlineError(ms)
          ctl.abort(e)
          reject(e)
        }),
      ms,
    )
    outer?.addEventListener('abort', onOuter)
    run(ctl.signal).then(
      (v) => finish(() => resolve(v)),
      (e: unknown) => finish(() => reject(e)),
    )
  })
}
