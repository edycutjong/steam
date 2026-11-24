// Wall time for the scheduler. Date.now keeps counting while a phone sleeps; performance.now may not.
export interface Clock {
  now(): number
}
export const systemClock: Clock = { now: () => Date.now() }

/** The UI never needs to wake faster than this to keep the timer right (R10.6). */
export const WAKE_MS = 250
