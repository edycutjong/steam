import { describe, expect, it, vi } from 'vitest'
import { createWakeLock, type SentinelLike } from './wakelock.ts'

const sentinel = (): SentinelLike & { release: ReturnType<typeof vi.fn> } => ({ release: vi.fn(async () => {}), addEventListener: vi.fn() })

describe('wake lock (R17)', () => {
  it('acquires a screen lock', async () => {
    const s = sentinel()
    const request = vi.fn(async () => s)
    const w = createWakeLock({ wakeLock: { request } })
    await w.acquire()
    expect(request).toHaveBeenCalledWith('screen')
    expect(w.status).toBe('held')
    await w.acquire()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('a refusal sets refused and is not retried until the page is visible again', async () => {
    const request = vi.fn(async () => { throw new Error('denied') })
    const w = createWakeLock({ wakeLock: { request } })
    await w.acquire()
    await w.acquire()
    expect(w.status).toBe('refused')
    expect(request).toHaveBeenCalledTimes(1)
    await w.onVisible()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('is unsupported without the API, and does nothing', async () => {
    const w = createWakeLock({})
    await w.acquire()
    w.release()
    expect(w.status).toBe('unsupported')
    expect(createWakeLock(undefined).status).toBe('unsupported')
  })
  it('release is idempotent', async () => {
    const s = sentinel()
    const w = createWakeLock({ wakeLock: { request: async () => s } })
    await w.acquire()
    w.release()
    w.release()
    expect(s.release).toHaveBeenCalledTimes(1)
    expect(w.status).toBe('idle')
  })
  it('a visibility change re-acquires a lock the browser released', async () => {
    const s1 = sentinel()
    const s2 = sentinel()
    const request = vi.fn().mockResolvedValueOnce(s1).mockResolvedValueOnce(s2)
    const w = createWakeLock({ wakeLock: { request } })
    await w.acquire()
    const onRelease = (s1.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]![1] as () => void
    onRelease() // the browser released it when the page was hidden
    expect(w.status).toBe('idle')
    await w.onVisible()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('held')
  })
})
