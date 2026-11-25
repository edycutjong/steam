import { useEffect, useId, useRef } from 'react'
import { WIPE } from '../../copy/strings.ts'
import { DEBOUNCE_MS } from '../../cook/drag.ts'
import type { Control } from '../../cook/scheduler.ts'

/** Space is left to the element when focus is inside another interactive element. */
export function isOtherInteractive(target: EventTarget | null, self: Element | null): boolean {
  if (!(target instanceof Element) || target === self) return false
  if (target === document.body) return false
  if (target.closest('button, a[href], input, select, textarea, summary, [contenteditable], [role="button"], [role="slider"]')) return true
  // a focusable region (the step text) scrolls with Space
  return target instanceof HTMLElement && target.tabIndex >= 0 && target.hasAttribute('tabindex')
}

interface Props {
  control: Control
  /** The pane is writing the revealed note: the label says so and the control does nothing until the note is held (R14.2, cook-mode-qa-r1 Q2). */
  writing: boolean
  /** The session is not running (loading, finishing): the table's label stays, the control does nothing. */
  disabled?: boolean
  /** Cook Mode is ready: take focus once, so Space and Enter work at once (R14.9). */
  ready: boolean
  /** `prefers-reduced-motion`: nothing is written stroke by stroke, the note appears (cook-layout-p1d L6). */
  reduced?: boolean
  onAct: (c: Control) => void
  /** Wall-clock source for the debounce (tests). */
  now?: () => number
}

/** The one large control, labelled and driven by the Wipe table (R14). A second activation within 400 ms is ignored. */
export default function WipeControl({ control, writing, disabled = false, ready, reduced = false, onAct, now = () => performance.now() }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  const last = useRef(-Infinity)
  const inactive = writing || disabled
  const latest = useRef({ control, writing: inactive, onAct })
  latest.current = { control, writing: inactive, onAct }
  const descId = useId()

  const act = () => {
    const { control: c, writing: w, onAct: f } = latest.current
    if (w) return
    const t = now()
    if (t - last.current < DEBOUNCE_MS) return
    last.current = t
    f(c)
  }
  const actRef = useRef(act)
  actRef.current = act

  useEffect(() => {
    if (ready) ref.current?.focus({ preventScroll: true })
  }, [ready])

  // Space anywhere does what the button does, unless another control has focus; the page does not scroll (R14.5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (e.repeat) {
        e.preventDefault()
        return
      }
      if (e.target === ref.current) return // the focused button acts natively on keyup
      if (isOtherInteractive(e.target, ref.current)) return
      e.preventDefault()
      actRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="wipe"
        aria-disabled={inactive ? true : undefined}
        aria-describedby={writing ? descId : undefined}
        data-action={control.action}
        onClick={act}
      >
        {writing ? (reduced ? WIPE.show : WIPE.handWriting) : control.label}
      </button>
      <span id={descId} className="sr-only">
        {writing ? (reduced ? WIPE.appearing : WIPE.writing) : ''}
      </span>
    </>
  )
}
