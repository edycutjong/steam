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

// a2a-arch-r05 B7: the lock follows Cook Mode, and survives what a browser or an OS does to it.
describe('wake lock lifecycle (a2a-arch-r05 B7)', () => {
  const make = createWakeLock
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
  }
  const fire = (s: SentinelLike) => ((s.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]![1] as () => void)()

  it('(a) a request that resolves after release() releases its sentinel at once and the status stays idle', async () => {
    const d = deferred<SentinelLike>()
    const w = make({ wakeLock: { request: () => d.promise } })
    const p = w.acquire()
    w.release()
    const s = sentinel()
    d.resolve(s)
    await p
    expect(s.release).toHaveBeenCalledTimes(1)
    expect(w.status).toBe('idle')
  })
  it('(a) a request that is refused after release() leaves the status idle, not refused', async () => {
    const d = deferred<SentinelLike>()
    const w = make({ wakeLock: { request: () => d.promise } })
    const p = w.acquire()
    w.release()
    d.reject(new Error('NotAllowedError'))
    await p
    expect(w.status).toBe('idle')
  })
  it('(a) after release() a new acquire is not blocked by the old request', async () => {
    const d = deferred<SentinelLike>()
    const s2 = sentinel()
    const request = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValueOnce(s2)
    const w = make({ wakeLock: { request } })
    void w.acquire()
    w.release()
    await w.acquire()
    expect(w.status).toBe('held')
    const s1 = sentinel()
    d.resolve(s1)
    await flush()
    expect(s1.release).toHaveBeenCalledTimes(1)
    expect(s2.release).not.toHaveBeenCalled()
    expect(w.status).toBe('held')
  })
  it('(b) a release from the browser while the page is visible asks again, once', async () => {
    const s1 = sentinel()
    const s2 = sentinel()
    const request = vi.fn().mockResolvedValueOnce(s1).mockResolvedValueOnce(s2)
    const changes: string[] = []
    let w!: ReturnType<typeof make>
    w = make({ wakeLock: { request } }, { visible: () => true, onChange: () => void changes.push(w.status) })
    await w.acquire()
    fire(s1)
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('held')
    expect(changes.at(-1)).toBe('held')
  })
  it('(b) a refusal of that second request stops it: no loop', async () => {
    const s1 = sentinel()
    const request = vi.fn().mockResolvedValueOnce(s1).mockRejectedValue(new Error('battery saver'))
    const w = make({ wakeLock: { request } }, { visible: () => true })
    await w.acquire()
    fire(s1)
    await flush()
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('refused')
  })
  it('(b) a lock the browser keeps releasing is asked for once, then left until a hide/show or a gesture', async () => {
    const sentinels = [sentinel(), sentinel(), sentinel()]
    let i = 0
    const request = vi.fn(async () => sentinels[i++]!)
    const w = make({ wakeLock: { request } }, { visible: () => true })
    await w.acquire()
    fire(sentinels[0]!)
    await flush()
    fire(sentinels[1]!)
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('idle')
  })
  it('(b) no new request for a release while the page is hidden, or for our own release()', async () => {
    const s1 = sentinel()
    const request = vi.fn().mockResolvedValue(s1)
    let visible = false
    const w = make({ wakeLock: { request } }, { visible: () => visible })
    await w.acquire()
    fire(s1)
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    visible = true
    const s2 = sentinel()
    request.mockResolvedValue(s2)
    await w.acquire()
    w.release()
    fire(s2) // a real sentinel dispatches "release" when we release it
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('idle')
  })
  it('(c) a refusal is tried again on the next gesture, once per gesture, and a held lock is left alone', async () => {
    const s = sentinel()
    const request = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(s)
    const w = make({ wakeLock: { request } })
    await w.acquire()
    expect(w.status).toBe('refused')
    const a = w.onGesture()
    const b = w.onGesture() // the same gesture reaching two listeners
    await Promise.all([a, b])
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('held')
    await w.onGesture()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('(c) a gesture that is refused again leaves the lock refused and asks nothing more by itself', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'))
    const w = make({ wakeLock: { request } })
    await w.acquire()
    await w.onGesture()
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('refused')
  })
  it('does nothing without the API', async () => {
    const w = make({})
    await w.onGesture()
    expect(w.status).toBe('unsupported')
  })
})

// a2a-arch-r06 C4: after the one automatic re-acquire has been used, a gesture is how a lock the browser took away comes back.
describe('a gesture asks again for a lock that is idle (a2a-arch-r06 C4)', () => {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  const fire = (s: SentinelLike) => ((s.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]![1] as () => void)()
  /** A lock the browser has released twice: the automatic re-acquire is spent and the status is idle. */
  async function spent() {
    const sentinels = Array.from({ length: 5 }, sentinel)
    let i = 0
    const request = vi.fn(async () => sentinels[i++]!)
    const w = createWakeLock({ wakeLock: { request } }, { visible: () => true })
    await w.acquire()
    fire(sentinels[0]!)
    await flush()
    fire(sentinels[1]!)
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('idle')
    return { w, request, sentinels }
  }

  it('the next gesture asks again, and the lock is held', async () => {
    const { w, request } = await spent()
    await w.onGesture()
    expect(request).toHaveBeenCalledTimes(3)
    expect(w.status).toBe('held')
  })
  it('the automatic re-acquire is spent again by that gesture: one more release is answered once, then a gesture is needed', async () => {
    const { w, request, sentinels } = await spent()
    await w.onGesture()
    fire(sentinels[2]!)
    await flush()
    expect(request).toHaveBeenCalledTimes(4) // once, by itself
    fire(sentinels[3]!)
    await flush()
    expect(request).toHaveBeenCalledTimes(4) // no loop
    expect(w.status).toBe('idle')
    await w.onGesture()
    expect(request).toHaveBeenCalledTimes(5)
    expect(w.status).toBe('held')
  })
  it('a gesture refused again leaves it refused and asks nothing by itself', async () => {
    const { w, request } = await spent()
    request.mockRejectedValueOnce(new Error('denied'))
    await w.onGesture()
    await flush()
    expect(request).toHaveBeenCalledTimes(3)
    expect(w.status).toBe('refused')
  })
  it('a gesture while the lock is held asks nothing', async () => {
    const { w, request } = await spent()
    await w.onGesture()
    await w.onGesture()
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('a gesture while a request is in flight does not start a second one', async () => {
    const { w, request } = await spent()
    const a = w.onGesture()
    const b = w.onGesture()
    await Promise.all([a, b])
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('a gesture after release() (Cook Mode closed) asks nothing', async () => {
    const { w, request } = await spent()
    w.release()
    await w.onGesture()
    expect(request).toHaveBeenCalledTimes(2)
    expect(w.status).toBe('idle')
  })
  it('a gesture asks nothing without the API', async () => {
    const w = createWakeLock({})
    await w.onGesture()
    expect(w.status).toBe('unsupported')
  })
})
