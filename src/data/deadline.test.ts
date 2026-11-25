// a2a-arch-r06 C2: a request that hangs is aborted at its deadline; a caller's own abort stays an abort.
import { describe, expect, it } from 'vitest'
import { DeadlineError, NOTE_DEADLINE_MS, PANE_JSON_DEADLINE_MS, RECIPE_DEADLINE_MS, withDeadline } from './deadline.ts'
import { fakeTimers, settle } from './timers.fixture.ts'

const never = (): Promise<never> => new Promise<never>(() => {})
const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' })

describe('withDeadline (a2a-arch-r06 C2)', () => {
  it('the deadlines are 10 s for the recipe, 15 s for a note asset and 10 s for the spike page JSON', () => {
    expect([RECIPE_DEADLINE_MS, NOTE_DEADLINE_MS, PANE_JSON_DEADLINE_MS]).toEqual([10_000, 15_000, 10_000])
  })
  it('passes the value through and clears its timer as soon as the request settles', async () => {
    const t = fakeTimers()
    await expect(withDeadline(5000, async () => 7, { timers: t })).resolves.toBe(7)
    expect(t.pending).toBe(0)
  })
  it('passes the error of a request that fails before the deadline through, and clears its timer', async () => {
    const t = fakeTimers()
    const boom = new TypeError('offline')
    await expect(withDeadline(5000, async () => Promise.reject(boom), { timers: t })).rejects.toBe(boom)
    expect(t.pending).toBe(0)
  })
  it('a request that never settles ends with a DeadlineError at the deadline, not before, and its signal is aborted', async () => {
    const t = fakeTimers()
    let sig!: AbortSignal
    const p = withDeadline(5000, (s) => ((sig = s), never()), { timers: t })
    const seen = p.then(() => 'resolved', (e: unknown) => e)
    t.advance(4999)
    await settle()
    expect(sig.aborted).toBe(false)
    t.advance(1)
    const e = await seen
    expect(e).toBeInstanceOf(DeadlineError)
    expect((e as DeadlineError).message).toBe('no answer within 5 s')
    expect(sig.aborted).toBe(true)
    expect(t.pending).toBe(0)
  })
  it('a request that honours the abort and throws AbortError is still reported as the deadline', async () => {
    const t = fakeTimers()
    const p = withDeadline(5000, (s) => new Promise<never>((_r, rej) => s.addEventListener('abort', () => rej(abortError()))), { timers: t })
    const seen = p.then(() => 'resolved', (e: unknown) => e)
    t.advance(5000)
    expect(await seen).toBeInstanceOf(DeadlineError)
  })
  it('the caller\'s own abort is re-thrown as an abort, reaches the request and is not a DeadlineError', async () => {
    const t = fakeTimers()
    const ctl = new AbortController()
    let sig!: AbortSignal
    const p = withDeadline(5000, (s) => ((sig = s), never()), { timers: t, signal: ctl.signal })
    const seen = p.then(() => 'resolved', (e: unknown) => e)
    await settle()
    ctl.abort()
    const e = (await seen) as Error
    expect(e).not.toBeInstanceOf(DeadlineError)
    expect(e.name).toBe('AbortError')
    expect(sig.aborted).toBe(true)
    expect(t.pending).toBe(0)
  })
  it('a signal that is already aborted never starts the request', async () => {
    const t = fakeTimers()
    const ctl = new AbortController()
    ctl.abort()
    let ran = false
    const e = await withDeadline(5000, () => ((ran = true), never()), { timers: t, signal: ctl.signal }).catch((x: unknown) => x)
    expect(ran).toBe(false)
    expect((e as Error).name).toBe('AbortError')
    expect(t.pending).toBe(0)
  })
  it('uses the global timers when none are given', async () => {
    const e = await withDeadline(5, () => never()).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(DeadlineError)
  })
})
