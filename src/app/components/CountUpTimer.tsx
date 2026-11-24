import { useEffect, useState } from 'react'
import type { Clock } from '../../cook/clock.ts'
import { WAKE_MS } from '../../cook/clock.ts'
import type { Plan } from '../../cook/plan.ts'
import { elapsedMs, type SchedState } from '../../cook/scheduler.ts'
import { emberActive, formatElapsed } from '../../cook/timing.ts'

/** The step clock, computed from wall time and the pace history at every wake; nothing accumulates between wakes (R10). */
export default function CountUpTimer({ plan, state, clock }: { plan: Plan | null; state: SchedState; clock: Clock }) {
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
  return (
    <div className={`timer ${ember ? 'timer--ember' : ''}`} role="timer" aria-live="off" data-ms={Math.floor(ms)}>
      {formatElapsed(ms)}
    </div>
  )
}
