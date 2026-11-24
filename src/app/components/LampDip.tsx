import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { cueEnvelope, LAMP_DIP_MS } from '../../cook/cue.ts'

export interface LampHandle {
  /** One dip of the hood lamp: a --bg layer over the screen, opacity 1 - lamp over LAMP_DIP_MS. */
  dip(): void
}

/** The lamp overlay (R16.1, R16.2). Opacity only, one change of brightness per cue, under reduced motion too. */
const LampDip = forwardRef<LampHandle>(function LampDip(_props, ref) {
  const el = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  useImperativeHandle(ref, () => ({
    dip() {
      const node = el.current
      if (!node) return
      cancelAnimationFrame(raf.current)
      const t0 = performance.now()
      node.dataset.dips = String(Number(node.dataset.dips ?? 0) + 1)
      const frame = (now: number) => {
        const t = now - t0
        node.style.opacity = String(1 - cueEnvelope(t).lamp)
        if (t < LAMP_DIP_MS) raf.current = requestAnimationFrame(frame)
        else node.style.opacity = String(0)
      }
      raf.current = requestAnimationFrame(frame)
    },
  }))
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return <div ref={el} className="lamp" aria-hidden="true" data-testid="lamp" />
})
export default LampDip
