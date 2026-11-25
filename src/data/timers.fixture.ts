// Timer functions a test drives by hand (a2a-arch-r06 C2): nothing fires until `advance`.
import type { DeadlineTimers } from './deadline.ts'

export interface FakeTimers extends DeadlineTimers {
  /** Moves the clock forward and fires, in order, every timer that is due. */
  advance(ms: number): void
  /** Timers set and not yet fired or cleared. */
  readonly pending: number
}

export function fakeTimers(): FakeTimers {
  let now = 0
  let id = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimeout(fn, ms) {
      queue.set(++id, { at: now + ms, fn })
      return id
    },
    clearTimeout(h) {
      queue.delete(h as number)
    },
    advance(ms) {
      now += ms
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) return
        queue.delete(due[0])
        due[1].fn()
      }
    },
    get pending() {
      return queue.size
    },
  }
}

/** One macrotask: lets every promise chain that can run, run. */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
