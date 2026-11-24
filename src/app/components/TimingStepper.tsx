import { useEffect, useId, useState } from 'react'
import { ANNOUNCE, TIMING } from '../../copy/strings.ts'
import { checkLabel, effectiveCheckAt, formatDuration, stepSeconds } from '../../cook/timing.ts'
import type { BundleNote } from '../../data/schema.ts'
import { useApp } from '../AppContext.tsx'

interface Props {
  recipeId: string
  note: BundleNote
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}

/** The moment of a note and the cook's own check time for this device (R7.3, R8.2 to R8.6). It never invents a time: the label names its source. */
export default function TimingStepper({ recipeId, note, overrides, setOverrides }: Props) {
  const { store, announce } = useApp()
  const [open, setOpen] = useState(false)
  const [persistent, setPersistent] = useState(true)
  const id = useId()
  const eff = effectiveCheckAt(note, overrides)
  const label = checkLabel(eff)
  useEffect(() => {
    let live = true
    void store.then((s) => live && setPersistent(s.persistent))
    return () => {
      live = false
    }
  }, [store])

  const commit = async (next: Record<string, number>, write: (s: Awaited<typeof store>) => Promise<void>) => {
    setOverrides(next)
    announce(ANNOUNCE.timing(note.span, checkLabel(effectiveCheckAt(note, next))))
    const s = await store
    await write(s).catch(() => {})
    setPersistent(s.persistent)
  }
  const move = (dir: -1 | 1) => {
    const v = stepSeconds(eff.seconds, dir)
    void commit({ ...overrides, [note.id]: v }, (s) => s.putTiming(recipeId, note.id, v))
  }
  const reset = () => {
    const { [note.id]: _gone, ...rest } = overrides
    void _gone
    void commit(rest, (s) => s.deleteTiming(recipeId, note.id))
  }

  return (
    <>
      <button type="button" className="moment-btn" aria-expanded={open} aria-controls={id} aria-label={`${TIMING.open}: ${note.span}, ${label}`} onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <span className="moment-btn__quote">“{note.span}”</span>
      </button>
      <div id={id} className="stepper" hidden={!open}>
        {open ? (
          <>
            <div className="stepper__row">
              <button type="button" className="btn" onClick={() => move(-1)}>
                {TIMING.earlier}
              </button>
              <output className="stepper__value">{eff.seconds === 0 ? label : formatDuration(eff.seconds)}</output>
              <button type="button" className="btn" onClick={() => move(1)}>
                {TIMING.later}
              </button>
              <button type="button" className="btn btn--quiet" onClick={reset}>
                {TIMING.reset}
              </button>
            </div>
            <p className="stepper__basis">
              {TIMING.basis}: {eff.basis}
            </p>
            {persistent ? null : <p className="stepper__basis">{TIMING.notSaved}</p>}
          </>
        ) : null}
      </div>
    </>
  )
}
