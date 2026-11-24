// Notes are decoded and derived ahead of their reveal and kept for the session (R15.11). `derive` blocks the main thread
// (96 ms unthrottled, 353 ms at 4x throttle), so no preparation starts while a pane is writing (R26.3).
import { loadNoteAssets, type NoteCheck } from './assets.ts'
import { derive } from './derive.ts'
import type { Loaded } from './SteamGlass.tsx'

export interface PrepareDeps {
  load?: typeof loadNoteAssets
  derive?: typeof derive
}

export function createPreparer(deps: PrepareDeps = {}) {
  const load = deps.load ?? loadNoteAssets
  const run = deps.derive ?? derive
  const cache = new Map<string, Promise<Loaded>>()
  const prepare = (stem: string, check?: NoteCheck): Promise<Loaded> => {
    let p = cache.get(stem)
    if (!p) {
      p = load(stem, check).then((assets) => {
        const start = performance.now()
        const derived = run(assets.toi, assets.noteData)
        performance.measure('steam:derive', { start, end: performance.now() })
        return { assets, derived }
      })
      // a failure is not cached, so a later pane may try again
      p.catch(() => cache.delete(stem))
      cache.set(stem, p)
    }
    return p
  }
  /** Prepares the queue in order, one at a time, in idle time, waiting while `busy()` (a pane is writing). Returns a cancel. */
  const prepareInIdle = (queue: { stem: string; check?: NoteCheck }[], busy: () => boolean): (() => void) => {
    let stopped = false
    let handle: ReturnType<typeof setTimeout> | number | undefined
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
    const later = (f: () => void, ms = 0) => {
      handle = ric && ms === 0 ? ric(f) : setTimeout(f, ms)
    }
    const next = (i: number) => {
      if (stopped || i >= queue.length) return
      if (busy()) return later(() => next(i), 250)
      const q = queue[i]!
      prepare(q.stem, q.check).catch(() => {}).finally(() => later(() => next(i + 1)))
    }
    later(() => next(0))
    return () => {
      stopped = true
      if (typeof handle === 'number' && cic) cic(handle)
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
  }
  return { prepare, prepareInIdle, has: (stem: string) => cache.has(stem) }
}
export type Preparer = ReturnType<typeof createPreparer>
