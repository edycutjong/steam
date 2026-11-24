// The fallback glass: pre-rendered images of the live renderer's own output, crossfaded by opacity only.
// Used without WebGL2, after an unrecovered context loss, and under prefers-reduced-motion.
// The sash frame, button, credit and live region are the SteamPane's, so both paths share them.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { chooseLayout } from './layout.ts'
import type { LayoutKind } from './layout.ts'
import type { SteamParams } from './params.ts'
import type { Phase, RevealState } from './timeline.ts'
import { revealState, THICKEN_MS } from './timeline.ts'

export const HERO_DIR = '/hero'
export const CROSSFADE_MS = 600
const STATE_PERIOD_MS = 100

export function paneImage(kind: LayoutKind, which: 'fogged' | 'held' | 'wiped'): string {
  return `${HERO_DIR}/pane-${kind}-${which}.webp`
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
  params: SteamParams
  /** Receives the controller the button and Space key drive. */
  controllerRef: RefObject<{ startReveal(): void; wipe(): void } | null>
  onState: (s: RevealState) => void
  /** Show only the fogged image and run no clock (the note could not be loaded). */
  fogOnly?: boolean
}

export default function StaticPane({ params, controllerRef, onState, fogOnly = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<LayoutKind>(() => chooseLayout(window.innerWidth))
  const [phase, setPhase] = useState<Phase>('fogged')

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
    const clock = new RevealClock(params.t, params.lead, performance.now())
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
      <img src={paneImage(kind, 'fogged')} alt="" aria-hidden="true" />
      <img src={paneImage(kind, 'held')} alt="" aria-hidden="true" style={layer(show.held)} />
      <img src={paneImage(kind, 'wiped')} alt="" aria-hidden="true" style={layer(show.wiped)} />
    </div>
  )
}
