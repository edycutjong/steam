import { useRef } from 'react'
import { PACE } from '../../copy/strings.ts'
import type { Pace } from '../../cook/scheduler.ts'

export const STOPS: readonly Pace[] = [1, 4, 12]
const ANGLES = [-60, 0, 60]

/** The flame knob: a slider with three stops, Real time, ×4 and ×12 (R11.1, R11.2). The flame under it brightens with the pace. */
export default function FlameKnob({ pace, onPace }: { pace: Pace; onPace: (p: Pace) => void }) {
  const i = Math.max(0, STOPS.indexOf(pace))
  const drag = useRef<{ x: number; i: number } | null>(null)
  const set = (k: number) => {
    const n = Math.min(STOPS.length - 1, Math.max(0, k))
    if (n !== i) onPace(STOPS[n]!)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(i - 1)
    else if (e.key === 'Home') set(0)
    else if (e.key === 'End') set(STOPS.length - 1)
    else return
    e.preventDefault()
  }
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, i }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    set(d.i + Math.round((e.clientX - d.x) / 40)) // snaps to the nearest stop
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && Math.abs(e.clientX - d.x) < 4) set((i + 1) % STOPS.length) // a click turns it one stop, wrapping
  }
  return (
    <div className="knob">
      <div
        className="knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={PACE.knobLabel}
        aria-valuemin={0}
        aria-valuemax={STOPS.length - 1}
        aria-valuenow={i}
        aria-valuetext={PACE.valueText[pace]}
        style={{ ['--knob-angle' as string]: `${ANGLES[i]}deg`, ['--flame' as string]: `${[30, 55, 85][i]}%` }}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <span className="knob__flame" aria-hidden="true" />
      </div>
      <div className="knob__stops">
        {STOPS.map((p) => (
          <button key={p} type="button" className="knob__stop" tabIndex={-1} aria-current={p === pace} onClick={() => p !== pace && onPace(p)}>
            {PACE.names[p]}
          </button>
        ))}
      </div>
    </div>
  )
}
