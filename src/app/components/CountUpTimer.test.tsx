// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from '../../cook/clock.ts'
import type { Plan } from '../../cook/plan.ts'
import { elapsedMs, initialState, reduce } from '../../cook/scheduler.ts'
import { formatElapsed } from '../../cook/timing.ts'
import { css, mount, text, tick, unmountAll } from '../render.fixture.tsx'
import CountUpTimer from './CountUpTimer.tsx'

const T0 = 1_000_000
beforeEach(() => vi.useFakeTimers({ now: T0 }))
afterEach(() => { unmountAll(); vi.useRealTimers() })
const plan: Plan = { steps: [{ note: { id: 'a', checkAtMs: 600_000 } }, { note: null }] }

describe('CountUpTimer (R10.1, R10.4 to R10.7)', () => {
  it('shows formatElapsed(elapsedMs(...)) for the clock, updating as it wakes', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 4 }).state
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    expect(text(h)).toBe('0:00')
    await tick(5_000)
    expect(text(h)).toBe(formatElapsed(elapsedMs(s, Date.now())))
    expect(text(h)).toBe('0:20')
  })
  it('after a simulated 3-hour freeze the first render shows the full time', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 1 }).state
    vi.setSystemTime(T0 + 3 * 3600_000)
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    expect(text(h)).toBe('3:00:00')
  })
  it('the ember class only in the last 10 s of wall time before a pending reveal, at any pace', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 12 }).state // due 50 s of wall time later
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    expect(h.querySelector('.timer')!.className).not.toContain('timer--ember')
    await tick(41_000)
    expect(h.querySelector('.timer')!.className).toContain('timer--ember')
    expect(/\.timer\s*\{[^}]*color:\s*var\(--muted\)/.test(css('src/app/cook.css'))).toBe(true)
    expect(/\.timer--ember\s*\{[^}]*color:\s*var\(--after\)/.test(css('src/app/cook.css'))).toBe(true)
  })
  it('has role="timer" and no live announcement', () => {
    const el = mount(<CountUpTimer plan={plan} state={initialState} clock={systemClock} />).querySelector('.timer')!
    expect(el.getAttribute('role')).toBe('timer')
    expect(el.getAttribute('aria-live')).toBe('off')
  })
})
