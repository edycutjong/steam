import { describe, expect, it, vi } from 'vitest'
import { createAudio, MUTE_RAMP_S, type AudioCtx } from './audio.ts'
import { SIMMER_GAIN } from './cue.ts'

// A fake AudioContext: it records what the engine does to it.
function fakeCtx() {
  const calls: string[] = []
  const gainEvents: { kind: string; v: number; t: number }[] = []
  const gain = {
    value: -1,
    cancelScheduledValues: (t: number) => void gainEvents.push({ kind: 'cancel', v: 0, t }),
    setValueAtTime: (v: number, t: number) => void gainEvents.push({ kind: 'set', v, t }),
    linearRampToValueAtTime: (v: number, t: number) => void gainEvents.push({ kind: 'ramp', v, t }),
  }
  const ctx: AudioCtx = {
    currentTime: 10,
    sampleRate: 8000,
    destination: {},
    resume: async () => void calls.push('resume'),
    suspend: async () => void calls.push('suspend'),
    createBuffer: (_c, n) => { const d = new Float32Array(n); return { getChannelData: () => d } },
    createBufferSource: () => ({ buffer: null, loop: false, connect: () => {}, start: () => void calls.push('start') }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect: () => {} }),
    createGain: () => ({ gain, connect: () => {} }),
  }
  return { ctx, calls, gain, gainEvents }
}
const memStore = (muted?: boolean) => {
  const data = new Map<string, unknown>(muted === undefined ? [] : [['muted', muted]])
  return { data, getSetting: async <T,>(k: string) => data.get(k) as T | undefined, putSetting: async (k: string, v: unknown) => void data.set(k, v) }
}
const fakeDoc = () => {
  const l = new Set<() => void>()
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (_: string, f: () => void) => l.add(f), removeEventListener: (_: string, f: () => void) => l.delete(f) }
  return { doc: doc as unknown as Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>, set: (v: DocumentVisibilityState) => { (doc as { visibilityState: string }).visibilityState = v; l.forEach((f) => f()) } }
}

describe('audio engine (R16.3 to R16.7)', () => {
  it('never calls the context factory before unlock()', () => {
    const factory = vi.fn(() => null)
    const a = createAudio({ createContext: factory, doc: fakeDoc().doc }, memStore())
    a.duck()
    a.setMuted(false)
    expect(factory).not.toHaveBeenCalled()
    expect(a.state).toBe('locked')
  })
  it('unlock() creates and resumes once, starts the loop at SIMMER_GAIN, and a second call does nothing', () => {
    const f = fakeCtx()
    const factory = vi.fn(() => f.ctx)
    const a = createAudio({ createContext: factory, doc: fakeDoc().doc }, memStore())
    a.unlock()
    a.unlock()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(f.calls.filter((c) => c === 'resume').length).toBe(1)
    expect(f.calls).toContain('start')
    expect(f.gain.value).toBe(SIMMER_GAIN)
    expect(a.state).toBe('playing')
  })
  it('setMuted(true) ramps the gain to 0 within 100 ms of context time; state is muted; the choice is stored', async () => {
    const f = fakeCtx()
    const s = memStore()
    const a = createAudio({ createContext: () => f.ctx, doc: fakeDoc().doc }, s)
    a.unlock()
    a.setMuted(true)
    const ramp = f.gainEvents.filter((e) => e.kind === 'ramp').at(-1)!
    expect(ramp.v).toBe(0)
    expect(ramp.t - 10).toBeLessThanOrEqual(0.1)
    expect(MUTE_RAMP_S).toBeLessThanOrEqual(0.1)
    expect(a.state).toBe('muted')
    await Promise.resolve()
    expect(s.data.get('muted')).toBe(true)
  })
  it('muting before unlock keeps it silent after unlock', () => {
    const f = fakeCtx()
    const a = createAudio({ createContext: () => f.ctx, doc: fakeDoc().doc }, memStore())
    a.setMuted(true)
    a.unlock()
    expect(f.gain.value).toBe(0)
    expect(a.state).toBe('muted')
  })
  it('a muted choice read from the store silences the loop', async () => {
    const f = fakeCtx()
    const a = createAudio({ createContext: () => f.ctx, doc: fakeDoc().doc }, memStore(true))
    a.unlock()
    await new Promise((r) => setTimeout(r, 0))
    expect(a.state).toBe('muted')
    expect(f.gainEvents.some((e) => e.kind === 'ramp' && e.v === 0)).toBe(true)
  })
  it('duck() schedules the envelope and never exceeds SIMMER_GAIN; nothing when muted', () => {
    const f = fakeCtx()
    const a = createAudio({ createContext: () => f.ctx, doc: fakeDoc().doc }, memStore())
    a.unlock()
    a.duck()
    const v = f.gainEvents.filter((e) => e.kind !== 'cancel').map((e) => e.v)
    expect(v.length).toBeGreaterThan(10)
    expect(Math.max(...v)).toBeLessThanOrEqual(SIMMER_GAIN)
    expect(Math.min(...v)).toBeLessThan(SIMMER_GAIN * 0.1)
    a.setMuted(true)
    const n = f.gainEvents.length
    a.duck()
    expect(f.gainEvents.length).toBe(n)
  })
  it('with a factory that returns null, state is unavailable and nothing throws; one that throws too', () => {
    const a = createAudio({ createContext: () => null, doc: fakeDoc().doc }, memStore())
    a.unlock()
    expect(a.state).toBe('unavailable')
    expect(() => { a.duck(); a.setMuted(true); a.unlock() }).not.toThrow()
    const b = createAudio({ createContext: () => { throw new Error('no') }, doc: fakeDoc().doc }, memStore())
    b.unlock()
    expect(b.state).toBe('unavailable')
  })
  it('hiding the page suspends the context; showing it resumes unless muted', () => {
    const f = fakeCtx()
    const d = fakeDoc()
    const a = createAudio({ createContext: () => f.ctx, doc: d.doc }, memStore())
    a.unlock()
    d.set('hidden')
    expect(f.calls).toContain('suspend')
    d.set('visible')
    expect(f.calls.filter((c) => c === 'resume').length).toBe(2)
    a.setMuted(true)
    d.set('hidden')
    d.set('visible')
    expect(f.calls.filter((c) => c === 'resume').length).toBe(2)
  })
  it('subscribers hear about state changes', () => {
    const f = fakeCtx()
    const a = createAudio({ createContext: () => f.ctx, doc: fakeDoc().doc }, memStore())
    const cb = vi.fn()
    const off = a.subscribe(cb)
    a.unlock()
    a.setMuted(true)
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    a.setMuted(false)
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
