// Check times, their labels and the cook's own override (R8).

import type { CheckAt } from '../data/schema.ts'

/** The stepper moves in 30 s and ranges from 0 to 3 h. UI limits, not cooking times. */
export const TIMING_STEP_S = 30
export const TIMING_MAX_S = 10_800
export const OVERRIDE_BASIS = 'set by you on this device'

/** "<n> s" below 60 s, else "<m> min" or "<m> min <s> s". */
export function formatDuration(seconds: number): string {
  const n = Math.max(0, Math.round(seconds))
  if (n < 60) return `${n} s`
  const m = Math.floor(n / 60)
  const s = n % 60
  return s === 0 ? `${m} min` : `${m} min ${s} s`
}

/** Every check time names its source (R8.2). */
export function checkLabel(c: CheckAt): string {
  if (c.source === 'step-entry') return 'with its step'
  if (c.source === 'cited') return `check from ${formatDuration(c.seconds)} · cited: ${c.basis}`
  return c.seconds === 0 ? 'with its step · set by you' : `check from ${formatDuration(c.seconds)} · set by you`
}

/** The device override when there is one, else the bundle's (R8.1). */
export function effectiveCheckAt(note: { id: string; checkAt: CheckAt }, overrides: Record<string, number>): CheckAt {
  const o = overrides[note.id]
  return o === undefined ? note.checkAt : { seconds: o, source: 'cook', basis: OVERRIDE_BASIS }
}

/** One stepper press: 30 s earlier or later, clamped to [0, TIMING_MAX_S]. */
export function stepSeconds(current: number, dir: -1 | 1): number {
  return Math.min(TIMING_MAX_S, Math.max(0, current + dir * TIMING_STEP_S))
}
