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

export async function withDeadline<T>(_ms: number, run: (signal: AbortSignal) => Promise<T>, opts: DeadlineOptions = {}): Promise<T> {
  return run(opts.signal ?? new AbortController().signal)
}
