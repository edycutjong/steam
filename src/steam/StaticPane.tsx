// The fallback glass: pre-rendered images of the live renderer's own output, crossfaded by opacity only.
// Used without WebGL2, after an unrecovered context loss, and under prefers-reduced-motion.
// The sash frame, button, credit and live region are the SteamPane's, so both paths share them.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { chooseLayout } from './layout.ts'
import type { LayoutKind } from './layout.ts'
import type { SteamParams } from './params.ts'
import type { Phase, RevealState } from './timeline.ts'
import { REFOG_MS, revealState, THICKEN_MS, WIPE_MS, WRITE_ON_MS } from './timeline.ts'

export const CROSSFADE_MS = 600
const STATE_PERIOD_MS = 100

/** `<dir>/<noteId>-<kind>-<state>.webp`: one image per note, layout kind and state, made by `npm run static-panes` (R15.10). */
export function paneImage(dir: string, noteId: string, kind: LayoutKind, which: 'fogged' | 'held' | 'wiped'): string {
  return `${dir}/${noteId}-${kind}-${which}.webp`
}

/** Which of the stacked images are visible in a phase. Fogged is always the base. */
export function visibleLayers(phase: Phase): { held: boolean; wiped: boolean } {
  return { held: phase === 'writing' || phase === 'holding' || phase === 'wiped', wiped: phase === 'wiped' }
}

/** The reveal clock without a GPU: the same `revealState` the renderer uses. */
export class RevealClock {
  private revealStart: number
  private wipeAt: number | null = null
  private readonly frozen: number | null

  constructor(frozen: number | null, lead: number, now: number) {
    this.frozen = frozen
    this.revealStart = now + lead
  }

  /**
   * A clock that carries on from a state the live renderer last reported at `at`, for the fallback after a lost context
   * (cook-mode-qa-r1 Q8). The phase and the place in it come from the state; the time since `at` counts. A pane that was
   * still fogged had not been started: it waits for `startReveal`.
   */
  static resume(state: RevealState, at: number, now: number): RevealClock {
    const elapsed = Math.max(0, now - at)
    if (state.phase === 'fogged') return new RevealClock(null, Infinity, now)
    // invert the timeline's own easings
    const inv = (x: number): number => 0.5 - Math.sin(Math.asin(1 - 2 * x) / 3) // smoothstep
    let t: number
    let wipeAt: number | null = null
    if (state.phase === 'thickening') t = -THICKEN_MS + inv(state.thicken) * THICKEN_MS
    else if (state.phase === 'writing') t = state.u * WRITE_ON_MS
    else if (state.phase === 'holding') t = WRITE_ON_MS
    else {
      wipeAt = WRITE_ON_MS
      t = WRITE_ON_MS + state.wipe * WIPE_MS + (state.refog > 0 ? (1 - Math.cbrt(1 - state.refog)) * REFOG_MS : 0)
    }
    const c = new RevealClock(null, -(t + elapsed), now)
    c.wipeAt = wipeAt
    return c
  }

  state(now: number): RevealState {
    const t = this.frozen !== null ? this.frozen : now - this.revealStart
    return revealState(t, this.wipeAt)
  }

  startReveal(now: number): void {
    if (this.frozen !== null) return
    const phase = this.state(now).phase
    if (phase === 'fogged' || phase === 'thickening') this.revealStart = now
    else if (phase === 'wiped') {
      this.wipeAt = null
      this.revealStart = now + THICKEN_MS
    }
  }

  wipe(now: number): void {
    if (this.frozen !== null || this.state(now).phase !== 'holding') return
    this.wipeAt = now - this.revealStart
  }
}

interface Props {
  /** Folder of the pane images and the note they belong to. */
  paneDir: string
  noteId: string
  params: SteamParams
  /** Receives the controller the button and Space key drive. */
  controllerRef: RefObject<{ startReveal(): void; wipe(): void } | null>
  onState: (s: RevealState) => void
  /** Called once when the fogged image has decoded (or at once where decoding is unavailable). */
  onReady?: () => void
  /** Show only the fogged image and run no clock (the note could not be loaded). */
  fogOnly?: boolean
  /** The state the live renderer last reported and when: after a lost context the pane carries on from it (cook-mode-qa-r1 Q8). */
  resume?: { state: RevealState; at: number } | null
}

export default function StaticPane({ paneDir, noteId, params, controllerRef, onState, onReady, fogOnly = false, resume = null }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<LayoutKind>(() => chooseLayout(window.innerWidth))
  const [phase, setPhase] = useState<Phase>('fogged')
  const fogRef = useRef<HTMLImageElement>(null)
  const readyRef = useRef(onReady)
  const resumeRef = useRef(resume) // read once, when the pane mounts
  readyRef.current = onReady

  // Ready when the fogged base image has decoded; a missing or broken image does not hold the reveal back.
  useEffect(() => {
    const img = fogRef.current
    const done = (): void => readyRef.current?.()
    if (img && typeof img.decode === 'function') void img.decode().then(done, done)
    else done()
  }, [paneDir, noteId, kind])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setKind(chooseLayout(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (fogOnly) return
    const r = resumeRef.current
    const clock = r && params.t === null ? RevealClock.resume(r.state, r.at, performance.now()) : new RevealClock(params.t, params.lead, performance.now())
    const push = (): void => {
      const st = clock.state(performance.now())
      setPhase(st.phase)
      onState(st)
    }
    controllerRef.current = {
      startReveal: () => {
        clock.startReveal(performance.now())
        push()
      },
      wipe: () => {
        clock.wipe(performance.now())
        push()
      },
    }
    push()
    const timer = window.setInterval(push, STATE_PERIOD_MS)
    return () => {
      window.clearInterval(timer)
      controllerRef.current = null
    }
  }, [params, onState, controllerRef, fogOnly])

  const show = visibleLayers(phase)
  const layer = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transition: `opacity ${CROSSFADE_MS}ms ease-out`,
  })
  return (
    <div ref={rootRef} className="static-pane">
      <img ref={fogRef} src={paneImage(paneDir, noteId, kind, 'fogged')} alt="" aria-hidden="true" />
      {fogOnly ? null : <img src={paneImage(paneDir, noteId, kind, 'held')} alt="" aria-hidden="true" style={layer(show.held)} />}
      {fogOnly ? null : <img src={paneImage(paneDir, noteId, kind, 'wiped')} alt="" aria-hidden="true" style={layer(show.wiped)} />}
    </div>
  )
}
