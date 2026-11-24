// The simmer: brown noise through a low-pass filter and a gain, made in Web Audio after the first user gesture (R16).
// The context comes from an injected factory, so a test can prove it is not created before a gesture.

import type { Store } from '../data/store.ts'
import { brownNoise, simmerGainAt, SIMMER_GAIN } from './cue.ts'

/** The few members of an AudioContext that the engine touches. */
export interface AudioParamLike {
  value: number
  cancelScheduledValues(t: number): unknown
  setValueAtTime(v: number, t: number): unknown
  linearRampToValueAtTime(v: number, t: number): unknown
}
export interface AudioCtx {
  readonly currentTime: number
  readonly sampleRate: number
  readonly destination: unknown
  resume(): Promise<void>
  suspend(): Promise<void>
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(c: number): Float32Array }
  createBufferSource(): { buffer: unknown; loop: boolean; connect(n: unknown): unknown; start(t?: number): void }
  createBiquadFilter(): { type: string; frequency: { value: number }; connect(n: unknown): unknown }
  createGain(): { gain: AudioParamLike; connect(n: unknown): unknown }
}
export interface AudioDeps {
  createContext: () => AudioCtx | null
  /** Where visibilitychange comes from; defaults to the global document when there is one. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}
export type AudioState = 'locked' | 'playing' | 'muted' | 'unavailable'

export const MUTED_KEY = 'muted'
/** Muting ramps the gain to 0 in at most this long. */
export const MUTE_RAMP_S = 0.08
export const NOISE_SEED = 1750
const LOWPASS_HZ = 900

export function createAudio(deps: AudioDeps, store: Pick<Store, 'getSetting' | 'putSetting'>) {
  let ctx: AudioCtx | null = null
  let gain: ReturnType<AudioCtx['createGain']> | null = null
  let unlocked = false
  let unavailable = false
  let muted = false
  const subs = new Set<() => void>()
  const emit = () => subs.forEach((f) => f())
  const state = (): AudioState => (unavailable ? 'unavailable' : muted ? 'muted' : unlocked ? 'playing' : 'locked')

  const rampTo = (v: number) => {
    if (!ctx || !gain) return
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(v, now + MUTE_RAMP_S)
  }

  // The choice is kept on this device (R18.9). Reading it is asynchronous; a muted flag read late still silences the loop.
  void store.getSetting<boolean>(MUTED_KEY).then((v) => {
    if (v === true && !muted) {
      muted = true
      rampTo(0)
      emit()
    }
  }).catch(() => {})

  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined)
  const onVisibility = () => {
    if (!ctx) return
    if (doc?.visibilityState === 'hidden') void ctx.suspend().catch(() => {})
    else if (!muted) void ctx.resume().catch(() => {})
  }
  doc?.addEventListener('visibilitychange', onVisibility)

  return {
    /** First gesture: create and resume the context and start the loop (silent if muted). Does nothing the second time. */
    unlock(): void {
      if (unlocked || unavailable) return
      let c: AudioCtx | null = null
      try {
        c = deps.createContext()
      } catch {
        c = null
      }
      if (!c) {
        unavailable = true
        emit()
        return
      }
      ctx = c
      unlocked = true
      void c.resume().catch(() => {})
      const n = 2 * c.sampleRate
      const buf = c.createBuffer(1, n, c.sampleRate)
      buf.getChannelData(0).set(brownNoise(n, NOISE_SEED))
      const src = c.createBufferSource()
      src.buffer = buf
      src.loop = true
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = LOWPASS_HZ
      gain = c.createGain()
      gain.gain.value = muted ? 0 : SIMMER_GAIN
      src.connect(lp)
      lp.connect(gain)
      gain.connect(c.destination)
      src.start()
      emit()
    },
    setMuted(m: boolean): void {
      if (m === muted) return
      muted = m
      void store.putSetting(MUTED_KEY, m).catch(() => {})
      if (ctx) {
        rampTo(m ? 0 : SIMMER_GAIN)
        if (!m && doc?.visibilityState !== 'hidden') void ctx.resume().catch(() => {})
      }
      emit()
    },
    /** The simmer drops to near-silence and comes back (cueEnvelope). Never above SIMMER_GAIN; nothing when muted or locked. */
    duck(): void {
      if (!ctx || !gain || muted) return
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(simmerGainAt(0), now)
      for (let t = 50; t <= 2100; t += 50) gain.gain.linearRampToValueAtTime(simmerGainAt(t), now + t / 1000)
    },
    get state(): AudioState {
      return state()
    },
    subscribe(cb: () => void): () => void {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    dispose(): void {
      doc?.removeEventListener('visibilitychange', onVisibility)
      subs.clear()
    },
  }
}
export type Audio = ReturnType<typeof createAudio>
