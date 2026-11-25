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
    expect(h.querySelector('.timer__t')!.textContent).toBe('0:00')
    await tick(5_000)
    expect(h.querySelector('.timer__t')!.textContent).toBe(formatElapsed(elapsedMs(s, Date.now())))
    expect(h.querySelector('.timer__t')!.textContent).toBe('0:20')
  })
  it('after a simulated 3-hour freeze the first render shows the full time', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 1 }).state
    vi.setSystemTime(T0 + 3 * 3600_000)
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    expect(text(h)).toBe('3:00:00')
  })
  // cook-mode-qa-r1 Q1: a clock that runs faster than the wall must say so, in its text and in its accessible name
  it('at ×12 the timer says it is cooking time at ×12, in the visible text and the accessible name', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 12 }).state
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    await tick(15_000) // 3:00 of cooking time
    const el = h.querySelector('.timer')!
    expect(el.querySelector('.timer__t')!.textContent).toBe('3:00')
    expect(text(el)).toBe('3:00 cooking time at ×12')
    expect(el.getAttribute('aria-label')).toBe('3:00, cooking time at ×12')
  })
  it('at ×4 it says ×4; at real time it adds nothing and sets no name of its own', async () => {
    const four = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 4 }).state
    expect(text(mount(<CountUpTimer plan={plan} state={four} clock={systemClock} />))).toBe('0:00 cooking time at ×4')
    const one = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 1 }).state
    const el = mount(<CountUpTimer plan={plan} state={one} clock={systemClock} />).querySelector('.timer')!
    expect(text(el)).toBe('0:00')
    expect(el.getAttribute('aria-label')).toBeNull()
    expect(el.querySelector('.timer__pace')).toBeNull()
  })
  it('the pace caption follows a pace change from the state\'s own history', async () => {
    const a = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 1 })
    const b = reduce(plan, a.state, { type: 'setPace', pace: 12, wallMs: T0 + 1000 } as never)
    const h = mount(<CountUpTimer plan={plan} state={b.state} clock={systemClock} />)
    expect(h.querySelector('.timer__pace')!.textContent).toBe('cooking time at ×12')
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
  // cook-layout-p1d L5: the colour follows a named state, and only that
  it('names its state: running, ember in the last 10 s, paused when asleep, done when finished; the ember class goes with ember only', async () => {
    const s = reduce(plan, initialState, { type: 'start', wallMs: T0, pace: 12 }).state
    const h = mount(<CountUpTimer plan={plan} state={s} clock={systemClock} />)
    const el = () => h.querySelector('.timer')!
    expect(el().getAttribute('data-timer-state')).toBe('running')
    await tick(41_000)
    expect(el().getAttribute('data-timer-state')).toBe('ember')
    expect(el().className).toContain('timer--ember')
    const sleep = reduce(plan, s, { type: 'sleep', wallMs: T0 + 1000 } as never).state
    expect(mount(<CountUpTimer plan={plan} state={sleep} clock={systemClock} />).querySelector('.timer')!.getAttribute('data-timer-state')).toBe('paused')
    const done = { ...s, status: 'finished' as const }
    const d = mount(<CountUpTimer plan={plan} state={done} clock={systemClock} />).querySelector('.timer')!
    expect(d.getAttribute('data-timer-state')).toBe('done')
    expect(d.className).not.toContain('timer--ember')
  })
  it('has role="timer" and no live announcement', () => {
    const el = mount(<CountUpTimer plan={plan} state={initialState} clock={systemClock} />).querySelector('.timer')!
    expect(el.getAttribute('role')).toBe('timer')
    expect(el.getAttribute('aria-live')).toBe('off')
  })
})
