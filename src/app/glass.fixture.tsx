// A stand-in for SteamGlass in the Cook Mode DOM tests: no GPU, no fetch. It reports ready when told, and its controller
// moves through the renderer's phases on the timeline's own durations (writing for WRITE_ON_MS, then holding).
import { useEffect } from 'react'
import type { SteamGlassProps } from '../steam/SteamGlass.tsx'
import { WRITE_ON_MS, type Phase, type RevealState } from '../steam/timeline.ts'

export interface FakePane {
  props: SteamGlassProps
  started: number
  wiped: number
  phase: Phase
  ready(): void
  fail(): void
}
export const panes = new Map<string, FakePane>()
export let autoReady = true
export const setAutoReady = (v: boolean): void => void (autoReady = v)
const st = (phase: Phase): RevealState => ({ phase, u: 0, thicken: 0, head: 0, wipe: 0, refog: 0 })

export function FakeGlass(props: SteamGlassProps) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const set = (p: Phase) => {
      pane.phase = p
      props.onState?.(st(p))
    }
    const pane: FakePane = {
      props,
      started: 0,
      wiped: 0,
      phase: 'fogged',
      ready: () => props.onReady?.(),
      fail: () => props.onError?.(new Error('fake load failure')),
    }
    panes.set(props.noteId, pane)
    props.controllerRef.current = {
      startReveal: () => {
        pane.started++
        set('writing')
        t = setTimeout(() => set('holding'), WRITE_ON_MS)
      },
      wipe: () => {
        if (pane.phase !== 'holding') return
        pane.wiped++
        set('wiped')
      },
    }
    set(props.initial === 'held' ? 'holding' : 'fogged')
    if (autoReady) setTimeout(() => props.onReady?.(), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <i data-glass={props.noteId} />
}
