// The landing page (/landing/) and the pitch deck (/deck/) show the product's own steamed window: this file mounts
// src/steam/SteamGlass.tsx (the WebGL2 renderer, the night view, the candle and the haunting cue, with the static pane images as
// its fallback) into those two static pages. tools/site/vite-plugin.ts builds it into dist/site/glass.js + glass.css after the
// app's own build. Nothing here draws the glass: it only mounts the component and passes the harness's own parameters (t, lead).
import type { RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import type { GlassStatus, RevealController } from '../src/steam/SteamGlass.tsx'
import { buttonLabel } from '../src/steam/SteamPane.tsx'
import type { Phase, RevealState } from '../src/steam/timeline.ts'
import Glass from './GlassPane.tsx'

export interface GlassOptions {
  recipe: string
  note: string
  /** Frozen reveal clock in ms (the harness's ?t=), or null for the live clock. */
  t?: number | null
  /** Lead-in before the reveal, ms (the harness's ?lead=). */
  lead?: number
  /** 'held' opens on the written note, as Cook Mode does when a session resumes on a held note. */
  initial?: 'fogged' | 'held'
  onPhase?: (p: Phase) => void
  onStatus?: (s: GlassStatus) => void
}

export interface GlassHandle {
  readonly phase: Phase
  readonly status: GlassStatus
  /** What the product's button does: show the note when fogged, wipe the glass when it holds. */
  act(): void
  /** A fresh mount: fogged, the lead-in, the cue, then the hand writes again. */
  replay(): void
  update(next: Partial<GlassOptions>): void
  unmount(): void
}

export function mount(el: HTMLElement, opts: GlassOptions): GlassHandle {
  const ctl: RefObject<RevealController | null> = { current: null }
  const st = { phase: 'fogged' as Phase, status: 'loading' as GlassStatus, o: opts, key: 0 }
  const onState = (s: RevealState): void => {
    st.phase = s.phase
    st.o.onPhase?.(s.phase)
  }
  const onStatus = (s: GlassStatus): void => {
    st.status = s
    st.o.onStatus?.(s)
  }
  const root = createRoot(el)
  const draw = (): void => root.render(<Glass key={st.key} o={st.o} ctl={ctl} onState={onState} onStatus={onStatus} />)
  draw()
  return {
    get phase() {
      return st.phase
    },
    get status() {
      return st.status
    },
    act() {
      const c = ctl.current
      if (!c || st.o.t != null || st.phase === 'writing' || st.phase === 'thickening') return
      if (st.phase === 'holding') c.wipe()
      else c.startReveal()
    },
    replay() {
      st.key += 1
      st.phase = 'fogged'
      draw()
    },
    update(next) {
      // SteamGlass reads a frozen clock when it mounts, so a new t is a fresh mount (the preparer keeps the derived note)
      if ('t' in next && next.t !== st.o.t) st.key += 1
      st.o = { ...st.o, ...next }
      draw()
    },
    unmount() {
      root.unmount()
    },
  }
}

export { buttonLabel }
