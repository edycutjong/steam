import { useRef, type ReactNode } from 'react'
import { createDrag } from '../../cook/drag.ts'

/** A horizontal drag across the pane does what the Wipe control does at that moment (R14.4). The surface does not scroll (R14.9). */
export default function DragSurface({ onDrag, children, className = '' }: { onDrag: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<ReturnType<typeof createDrag> | null>(null)
  const id = useRef<number | null>(null)
  const sample = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() })
  return (
    <div
      ref={ref}
      className={`stage ${className}`}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        id.current = e.pointerId
        drag.current = createDrag(ref.current?.getBoundingClientRect().width ?? 0)
        drag.current.push(sample(e))
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== id.current || !drag.current) return
        if (drag.current.push(sample(e))) {
          drag.current = null
          onDrag()
        }
      }}
      onPointerUp={() => {
        drag.current = null
        id.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
        id.current = null
      }}
    >
      {children}
    </div>
  )
}
