import { useEffect, useState } from 'react'
import { PACE } from '../../copy/strings.ts'
import type { Clock } from '../../cook/clock.ts'
import { WAKE_MS } from '../../cook/clock.ts'
import type { Plan } from '../../cook/plan.ts'
import { elapsedMs, type Pace, type SchedState } from '../../cook/scheduler.ts'
import { emberActive, formatElapsed } from '../../cook/timing.ts'

/** The step clock, computed from wall time and the pace history at every wake; nothing accumulates between wakes (R10). */
export default function CountUpTimer({ plan, state, clock, pace }: { plan: Plan | null; state: SchedState; clock: Clock; pace?: Pace }) {
  const [, setNow] = useState(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setNow(clock.now())
      t = setTimeout(wake, WAKE_MS)
    }
    const onVis = () => setNow(clock.now())
    t = setTimeout(wake, WAKE_MS)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [clock])
  const now = clock.now()
  const ms = state.status === 'idle' ? 0 : elapsedMs(state, now)
  const ember = plan !== null && emberActive(plan, state, now)
  // The clock counts cooking time: at ×4 or ×12 it must say so, or "3:17" reads as real minutes (cook-mode-qa-r1 Q1).
  const p = pace ?? state.paceHistory.at(-1)?.pace ?? 1
  const digits = formatElapsed(ms)
  const caption = p === 1 ? null : PACE.cooking(p)
  return (
    <div className={`timer ${ember ? 'timer--ember' : ''}`} role="timer" aria-live="off" aria-label={caption ? `${digits}, ${caption}` : undefined} data-ms={Math.floor(ms)}>
      <span className="timer__t">{digits}</span>
      {caption ? (
        <>
          {' '}
          <span className="timer__pace">{caption}</span>
        </>
      ) : null}
    </div>
  )
}
